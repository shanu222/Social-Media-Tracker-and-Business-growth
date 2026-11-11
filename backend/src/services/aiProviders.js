import { many, one, query } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';

/*
 * AI with automatic fallback across any number of keys the admin manages in Settings.
 *
 * Keys live in the ai_keys table (encrypted with ENCRYPTION_KEY) and are tried in the admin's order.
 * For each key: main model, then fallback models. Temporary problems (rate limit, 5xx, timeout) are retried
 * up to AI_MAX_RETRIES times; an invalid/expired key or no credit/quota marks that key and moves straight to
 * the next one. Keys recently found invalid (6 h) or out of quota (1 h) are skipped so requests stay fast;
 * they are tried again after that, or immediately when the admin edits or tests them.
 *
 * On first start, keys found in environment variables (OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY,
 * ANTHROPIC_API_KEY …) are imported once so nothing has to be re-typed.
 *
 * Other env: AI_FALLBACK_ENABLED (true), AI_MAX_RETRIES (2), AI_TIMEOUT_MS (45000),
 *            AI_CACHE_ENABLED (true), AI_CACHE_TTL seconds (3600), AI_LOGGING (true), AI_LOG_LEVEL (info|debug)
 */

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const bool = (k, d) => (process.env[k] === undefined ? d : !/^(false|0|no|off)$/i.test(process.env[k]));
const list = (k) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

/** Providers the admin can choose from. `compat` = OpenAI-compatible chat API. */
export const PRESETS = {
  gemini: { label: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-2.5-flash', 'gemini-2.0-flash'], pricing: 'Free tier', keyUrl: 'https://aistudio.google.com/apikey' },
  groq: { label: 'Groq', type: 'compat', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'], pricing: 'Free tier', keyUrl: 'https://console.groq.com/keys' },
  cerebras: { label: 'Cerebras', type: 'compat', baseUrl: 'https://api.cerebras.ai/v1', models: ['llama-3.3-70b'], pricing: 'Free tier', keyUrl: 'https://cloud.cerebras.ai' },
  mistral: { label: 'Mistral', type: 'compat', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-small-latest'], pricing: 'Free tier', keyUrl: 'https://console.mistral.ai/api-keys' },
  openrouter: { label: 'OpenRouter', type: 'compat', baseUrl: 'https://openrouter.ai/api/v1', models: ['meta-llama/llama-3.3-70b-instruct:free'], pricing: 'Free models (:free) + paid', keyUrl: 'https://openrouter.ai/keys' },
  together: { label: 'Together AI', type: 'compat', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'], pricing: 'Some free models + paid', keyUrl: 'https://api.together.ai/settings/api-keys' },
  openai: { label: 'OpenAI', type: 'compat', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini'], pricing: 'Paid', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-5-5'], pricing: 'Paid', keyUrl: 'https://console.anthropic.com/settings/keys' },
  deepseek: { label: 'DeepSeek', type: 'compat', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'], pricing: 'Paid (low cost)', keyUrl: 'https://platform.deepseek.com/api_keys' },
  xai: { label: 'xAI Grok', type: 'compat', baseUrl: 'https://api.x.ai/v1', models: ['grok-3-mini'], pricing: 'Paid', keyUrl: 'https://console.x.ai' },
  custom: { label: 'Other (OpenAI-compatible)', type: 'compat', baseUrl: '', models: [], pricing: 'Depends on service', keyUrl: '' },
};
export const providerLabel = (p) => PRESETS[p]?.label || p;

/* ---------------- HTTP adapters ---------------- */

async function callCompat(base, apiKey, model, system, user, signal, extraHeaders = {}, jsonMode = true) {
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({
      model, temperature: 0.6,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw httpError(res.ok ? Number(d.error?.code) || 500 : res.status, d?.error?.message || d?.message, d?.error?.code || d?.error?.type);
  return d.choices?.[0]?.message?.content || '';
}

async function callGemini(base, apiKey, model, system, user, signal) {
  const res = await fetch(`${base.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, d?.error?.message, d?.error?.status || d?.error?.details?.[0]?.reason);
  return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function callAnthropic(base, apiKey, model, system, user, signal) {
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST', signal,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, d?.error?.message, d?.error?.type);
  return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

function callKey(k, model, system, user, signal) {
  const preset = PRESETS[k.provider] || PRESETS.custom;
  const base = k.base_url || preset.baseUrl;
  const apiKey = decrypt(k.key_enc);
  if (!apiKey) { const e = new Error('Stored key could not be decrypted (ENCRYPTION_KEY changed?) — re-enter it.'); e.state = 'invalid'; throw e; }
  if (preset.type === 'gemini') return callGemini(base, apiKey, model, system, user, signal);
  if (preset.type === 'anthropic') return callAnthropic(base, apiKey, model, system, user, signal);
  const extra = k.provider === 'openrouter' ? { 'HTTP-Referer': env('APP_URL', 'https://growth-desk.app'), 'X-Title': 'Growth Desk' } : {};
  // Not every compatible service supports JSON mode; OpenAI, Groq, Mistral, DeepSeek, Together and xAI do.
  const jsonMode = ['openai', 'groq', 'mistral', 'deepseek', 'together', 'xai', 'cerebras'].includes(k.provider);
  return callCompat(base, apiKey, model, system, user, signal, extra, jsonMode);
}

/** Map provider errors to something an admin can act on. */
function httpError(status, message = '', code = '') {
  const m = `${message} ${code}`.toLowerCase();
  let state = 'error';
  if (status === 401 || status === 403 || /invalid.?api.?key|api_key_invalid|incorrect api key|expired|unauthori[sz]ed|permission_denied|user not found/.test(m)) state = 'invalid';
  else if (status === 402 || /insufficient_quota|quota|billing|credit|resource_exhausted|payment/.test(m)) state = 'quota';
  else if (status === 429 || /rate.?limit/.test(m)) state = 'rate_limited';
  else if (status === 404 || /model.*(not found|does not exist)|not_found|no endpoints found/.test(m)) state = 'model';
  else if (status >= 500) state = 'unavailable';
  const e = new Error(message || `HTTP ${status}`);
  e.state = state;
  e.status = status;
  return e;
}

export const STATE_TEXT = {
  ok: 'Working',
  invalid: 'Key invalid or expired',
  quota: 'Out of credit / quota used up',
  rate_limited: 'Rate limited (temporary)',
  model: 'Model not available',
  unavailable: 'Service unavailable (temporary)',
  timeout: 'Timed out',
  bad_output: 'Returned an unreadable answer',
  error: 'Error',
  unknown: 'Not tested yet',
  paused: 'Paused',
};
const RETRYABLE = new Set(['rate_limited', 'unavailable', 'timeout', 'bad_output', 'error']);
const SKIP_KEY = new Set(['invalid', 'quota']);
const COOLDOWN_MS = { invalid: 6 * 3600e3, quota: 3600e3 };

function log(level, ...args) {
  if (!bool('AI_LOGGING', true)) return;
  if (level === 'debug' && env('AI_LOG_LEVEL', 'info') !== 'debug') return;
  console.log('[ai]', ...args);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mark(id, state, message, model) {
  await query(
    `UPDATE ai_keys SET state = $2, message = $3, last_model = coalesce($4, last_model), checked_at = now(),
       last_ok_at = CASE WHEN $2 = 'ok' THEN now() ELSE last_ok_at END WHERE id = $1`,
    [id, state, message ? String(message).slice(0, 300) : null, model]
  ).catch(() => {});
}

export async function activeKeys() {
  return many('SELECT * FROM ai_keys WHERE enabled = TRUE ORDER BY position, id').catch(() => []);
}
export async function aiEnabled() {
  const r = await one('SELECT count(*) AS n FROM ai_keys WHERE enabled = TRUE').catch(() => ({ n: 0 }));
  return Number(r.n) > 0;
}

/**
 * Ask the AI. `validate(text)` returns the parsed result or throws (→ retry / next model).
 * Returns { result, provider, model, keyLabel }. Throws `.code = 'AI_UNAVAILABLE'` with `.attempts` when everything fails.
 */
export async function complete(system, user, validate, { onlyKeyId, ignoreCooldown = false } = {}) {
  let keys = await activeKeys();
  if (onlyKeyId) keys = (await many('SELECT * FROM ai_keys WHERE id = $1', [onlyKeyId]));
  if (!bool('AI_FALLBACK_ENABLED', true) && !onlyKeyId) keys = keys.slice(0, 1);
  const retries = Math.max(0, Number(env('AI_MAX_RETRIES', '2')) || 0);
  const timeout = Number(env('AI_TIMEOUT_MS', '45000')) || 45000;
  const attempts = [];
  // Healthy keys first (keeping the admin's order), recently failed ones last
  const now = Date.now();
  const cooling = (k) => SKIP_KEY.has(k.state) && k.checked_at && now - new Date(k.checked_at).getTime() < COOLDOWN_MS[k.state];

  for (const k of keys) {
    const preset = PRESETS[k.provider] || PRESETS.custom;
    if (!ignoreCooldown && !onlyKeyId && cooling(k)) {
      attempts.push({ keyId: k.id, provider: k.provider, label: k.label, model: null, state: k.state, message: `Skipped — ${STATE_TEXT[k.state].toLowerCase()} (checked ${new Date(k.checked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` });
      continue;
    }
    const models = k.models?.length ? k.models : preset.models;
    let lastState = null, lastMsg = null;
    keyLoop: for (const model of models) {
      for (let i = 0; i <= retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const t0 = Date.now();
        try {
          const text = await callKey(k, model, system, user, ctrl.signal);
          let result;
          try { result = validate(text); } catch (ve) { const e = new Error(ve.message || 'Unreadable answer'); e.state = 'bad_output'; throw e; }
          log('info', `${k.label} (${k.provider}/${model}) ok in ${Date.now() - t0} ms`);
          await mark(k.id, 'ok', null, model);
          return { result, provider: k.provider, model, keyLabel: k.label };
        } catch (e) {
          const state = e.name === 'AbortError' ? 'timeout' : e.state || 'error';
          const msg = e.name === 'AbortError' ? `No answer within ${Math.round(timeout / 1000)} s` : e.message;
          lastState = state; lastMsg = msg;
          attempts.push({ keyId: k.id, provider: k.provider, label: k.label, model, state, message: msg });
          log(SKIP_KEY.has(state) ? 'info' : 'debug', `${k.label} (${k.provider}/${model}) failed: ${state} — ${msg}`);
          if (SKIP_KEY.has(state)) break keyLoop;
          if (state === 'model') break;
          if (!RETRYABLE.has(state) || i === retries) break;
          await sleep(Math.min(8000, 800 * 2 ** i));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    await mark(k.id, lastState || 'error', lastMsg, null);
  }
  const err = new Error(keys.length ? 'All AI keys failed.' : 'No AI key has been added.');
  err.code = 'AI_UNAVAILABLE';
  err.status = 503;
  err.attempts = attempts;
  throw err;
}

/* ---------------- key management ---------------- */

const hint = (k) => (k.length > 10 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '••••');

export function presentKey(k) {
  const preset = PRESETS[k.provider] || PRESETS.custom;
  const state = k.enabled ? k.state : 'paused';
  return {
    id: k.id, provider: k.provider, providerLabel: preset.label, pricing: preset.pricing, label: k.label,
    key_hint: k.key_hint, models: k.models?.length ? k.models : preset.models, customModels: Boolean(k.models?.length),
    base_url: k.base_url, position: k.position, enabled: k.enabled, state, stateText: STATE_TEXT[state] || state,
    message: k.message, last_model: k.last_model, checked_at: k.checked_at, last_ok_at: k.last_ok_at,
  };
}

export async function listKeys() {
  return (await many('SELECT * FROM ai_keys ORDER BY position, id')).map(presentKey);
}

export async function addKey({ provider, label, apiKey, models, base_url }) {
  const pos = await one('SELECT coalesce(max(position), 0) + 1 AS p FROM ai_keys');
  return one(
    `INSERT INTO ai_keys (provider, label, key_enc, key_hint, models, base_url, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [provider, label, encrypt(apiKey), hint(apiKey), models || [], base_url || null, pos.p]
  );
}

export async function updateKey(id, { label, apiKey, models, base_url, enabled }) {
  const cur = await one('SELECT * FROM ai_keys WHERE id = $1', [id]);
  if (!cur) return null;
  return one(
    `UPDATE ai_keys SET label = $2, key_enc = $3, key_hint = $4, models = $5, base_url = $6, enabled = $7,
       state = CASE WHEN $8 THEN 'unknown' ELSE state END, message = CASE WHEN $8 THEN NULL ELSE message END
     WHERE id = $1 RETURNING *`,
    [id, label ?? cur.label, apiKey ? encrypt(apiKey) : cur.key_enc, apiKey ? hint(apiKey) : cur.key_hint,
      models ?? cur.models, base_url === undefined ? cur.base_url : base_url || null, enabled ?? cur.enabled, Boolean(apiKey) || models !== undefined || base_url !== undefined]
  );
}

export async function reorderKeys(ids) {
  for (const [i, id] of ids.entries()) await query('UPDATE ai_keys SET position = $2 WHERE id = $1', [id, i + 1]);
}

// Any non-empty answer proves the key, model and account work.
const PING = ['Reply with a JSON object only.', 'Return {"ok": true}', (t) => { if (!t || !String(t).trim()) throw new Error('Empty reply'); return true; }];
export async function testKey(id) {
  try { await complete(PING[0], PING[1], PING[2], { onlyKeyId: id }); } catch { /* state recorded */ }
  return presentKey(await one('SELECT * FROM ai_keys WHERE id = $1', [id]));
}
export async function testAllKeys() {
  for (const k of await many('SELECT id FROM ai_keys WHERE enabled = TRUE ORDER BY position, id')) await testKey(k.id);
  return listKeys();
}

/** One-time import of keys from environment variables (kept for existing Railway setups). */
export async function importEnvKeys() {
  const { n } = await one('SELECT count(*)::int AS n FROM ai_keys');
  if (n > 0) return;
  const order = list('AI_PROVIDER_ORDER').length ? list('AI_PROVIDER_ORDER') : ['openai', 'gemini', 'openrouter', 'anthropic'];
  const fromEnv = {
    openai: { key: env('OPENAI_API_KEY'), models: [env('OPENAI_MODEL'), env('OPENAI_FALLBACK_MODEL')], base: env('OPENAI_BASE_URL') ? `${env('OPENAI_BASE_URL')}/v1` : '' },
    gemini: { key: env('GEMINI_API_KEY'), models: [env('GEMINI_MODEL'), env('GEMINI_FALLBACK_MODEL')], base: env('GEMINI_BASE_URL') },
    openrouter: { key: env('OPENROUTER_API_KEY'), models: list('OPENROUTER_MODELS'), base: env('OPENROUTER_BASE_URL') ? `${env('OPENROUTER_BASE_URL')}/v1` : '' },
    anthropic: { key: env('ANTHROPIC_API_KEY'), models: [env('ANTHROPIC_MODEL') || env('AI_MODEL')], base: env('ANTHROPIC_BASE_URL') || env('AI_BASE_URL') },
  };
  const providers = [...order, ...Object.keys(fromEnv).filter((p) => !order.includes(p))];
  let imported = 0;
  for (const p of providers) {
    const e = fromEnv[p];
    if (!e?.key) continue;
    await addKey({ provider: p, label: `${PRESETS[p].label} (from Railway)`, apiKey: e.key, models: e.models.filter(Boolean), base_url: e.base || null });
    imported++;
  }
  if (imported) console.log(`[ai] Imported ${imported} AI key(s) from environment variables. Manage them in Settings → AI providers.`);
}

/* -------- in-memory cache (per server instance) -------- */
const cache = new Map();
export function cacheGet(key) {
  if (!bool('AI_CACHE_ENABLED', true)) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  return hit.value;
}
export function cacheSet(key, value) {
  if (!bool('AI_CACHE_ENABLED', true)) return;
  const ttl = (Number(env('AI_CACHE_TTL', '3600')) || 3600) * 1000;
  cache.set(key, { value, expires: Date.now() + ttl });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}
