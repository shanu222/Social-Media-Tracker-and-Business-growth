import { many, query } from '../db.js';

/*
 * Multi-provider AI with automatic fallback.
 *
 * Order comes from AI_PROVIDER_ORDER (default "openai,gemini,openrouter,anthropic"). Each provider tries its main
 * model, then its fallback model(s). Temporary problems (rate limits, 5xx, timeouts) are retried up to
 * AI_MAX_RETRIES times with backoff. Problems with the key itself (invalid/expired, no credit/quota) skip straight
 * to the next provider and are recorded so the admin sees them in Settings.
 *
 * Env:
 *   OPENAI_API_KEY, OPENAI_MODEL (gpt-4.1-mini), OPENAI_FALLBACK_MODEL
 *   GEMINI_API_KEY, GEMINI_MODEL (gemini-2.5-flash), GEMINI_FALLBACK_MODEL
 *   OPENROUTER_API_KEY, OPENROUTER_MODELS (comma list, tried in order)
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL
 *   AI_PROVIDER_ORDER, AI_FALLBACK_ENABLED (true), AI_MAX_RETRIES (2), AI_TIMEOUT_MS (45000)
 *   AI_CACHE_ENABLED (true), AI_CACHE_TTL seconds (3600), AI_LOGGING (true), AI_LOG_LEVEL (info|debug)
 */

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const bool = (k, d) => (process.env[k] === undefined ? d : !/^(false|0|no|off)$/i.test(process.env[k]));
const list = (k) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    keyVar: 'OPENAI_API_KEY',
    models: () => [env('OPENAI_MODEL', 'gpt-4.1-mini'), env('OPENAI_FALLBACK_MODEL')].filter(Boolean),
    async call(model, system, user, signal) {
      const res = await fetch(`${env('OPENAI_BASE_URL', 'https://api.openai.com')}/v1/chat/completions`, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0.6, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, d?.error?.message, d?.error?.code || d?.error?.type);
      return d.choices?.[0]?.message?.content || '';
    },
  },
  gemini: {
    label: 'Google Gemini',
    keyVar: 'GEMINI_API_KEY',
    models: () => [env('GEMINI_MODEL', 'gemini-2.5-flash'), env('GEMINI_FALLBACK_MODEL')].filter(Boolean),
    async call(model, system, user, signal) {
      const res = await fetch(`${env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'x-goog-api-key': env('GEMINI_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, d?.error?.message, d?.error?.status || d?.error?.details?.[0]?.reason);
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
  openrouter: {
    label: 'OpenRouter',
    keyVar: 'OPENROUTER_API_KEY',
    models: () => (list('OPENROUTER_MODELS').length ? list('OPENROUTER_MODELS') : ['meta-llama/llama-3.3-70b-instruct:free']),
    async call(model, system, user, signal) {
      const res = await fetch(`${env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api')}/v1/chat/completions`, {
        method: 'POST', signal,
        headers: {
          Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json',
          'HTTP-Referer': env('APP_URL', 'https://growth-desk.app'), 'X-Title': 'Growth Desk',
        },
        body: JSON.stringify({ model, temperature: 0.6, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw httpError(res.ok ? d.error?.code || 500 : res.status, d?.error?.message, d?.error?.code);
      return d.choices?.[0]?.message?.content || '';
    },
  },
  anthropic: {
    label: 'Anthropic Claude',
    keyVar: 'ANTHROPIC_API_KEY',
    models: () => [env('ANTHROPIC_MODEL', env('AI_MODEL', 'claude-sonnet-5-5'))],
    async call(model, system, user, signal) {
      const res = await fetch(`${env('ANTHROPIC_BASE_URL', env('AI_BASE_URL', 'https://api.anthropic.com'))}/v1/messages`, {
        method: 'POST', signal,
        headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, d?.error?.message, d?.error?.type);
      return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  },
};

/** Map provider errors to something an admin can act on. */
function httpError(status, message = '', code = '') {
  const m = `${message} ${code}`.toLowerCase();
  let state = 'error';
  if (status === 401 || status === 403 || /invalid.?api.?key|api_key_invalid|incorrect api key|expired|unauthori[sz]ed|permission_denied/.test(m)) state = 'invalid';
  else if (status === 402 || /insufficient_quota|quota|billing|credit|resource_exhausted/.test(m)) state = 'quota';
  else if (status === 429 || /rate.?limit/.test(m)) state = 'rate_limited';
  else if (status === 404 || /model.*(not found|does not exist)|not_found/.test(m)) state = 'model';
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
  not_set: 'Not set',
};
const RETRYABLE = new Set(['rate_limited', 'unavailable', 'timeout', 'bad_output', 'error']);
const SKIP_PROVIDER = new Set(['invalid', 'quota']);

const configured = (p) => Boolean(env(PROVIDERS[p].keyVar));
export function providerOrder() {
  const order = list('AI_PROVIDER_ORDER').length ? list('AI_PROVIDER_ORDER') : ['openai', 'gemini', 'openrouter', 'anthropic'];
  const all = [...order, ...Object.keys(PROVIDERS).filter((p) => !order.includes(p))].filter((p) => PROVIDERS[p]);
  return all.filter(configured);
}
export const aiEnabled = () => providerOrder().length > 0;

function log(level, ...args) {
  if (!bool('AI_LOGGING', true)) return;
  if (level === 'debug' && env('AI_LOG_LEVEL', 'info') !== 'debug') return;
  console.log('[ai]', ...args);
}

async function record(provider, state, message, model) {
  await query(
    `INSERT INTO ai_status (provider, state, message, model, checked_at, last_ok_at)
     VALUES ($1,$2,$3,$4,now(), CASE WHEN $2 = 'ok' THEN now() END)
     ON CONFLICT (provider) DO UPDATE SET state = EXCLUDED.state, message = EXCLUDED.message, model = EXCLUDED.model,
       checked_at = now(), last_ok_at = CASE WHEN EXCLUDED.state = 'ok' THEN now() ELSE ai_status.last_ok_at END`,
    [provider, state, message ? String(message).slice(0, 300) : null, model]
  ).catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the AI. `validate(text)` must return the parsed result or throw (bad output → try again / next model).
 * Returns { result, provider, model }. Throws an error with `.attempts` describing every failure.
 */
export async function complete(system, user, validate, { only } = {}) {
  const providers = only ? [only].filter((p) => PROVIDERS[p] && configured(p)) : providerOrder();
  const chain = bool('AI_FALLBACK_ENABLED', true) ? providers : providers.slice(0, 1);
  const retries = Math.max(0, Number(env('AI_MAX_RETRIES', '2')) || 0);
  const timeout = Number(env('AI_TIMEOUT_MS', '45000')) || 45000;
  const attempts = [];

  for (const p of chain) {
    const prov = PROVIDERS[p];
    let lastState = null;
    let lastMsg = null;
    providerLoop: for (const model of prov.models()) {
      for (let i = 0; i <= retries; i++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        const t0 = Date.now();
        try {
          const text = await prov.call(model, system, user, ctrl.signal);
          let result;
          try {
            result = validate(text);
          } catch (ve) {
            const e = new Error(ve.message || 'Unreadable answer');
            e.state = 'bad_output';
            throw e;
          }
          log('info', `${p}/${model} ok in ${Date.now() - t0} ms`);
          await record(p, 'ok', null, model);
          return { result, provider: p, model };
        } catch (e) {
          const state = e.name === 'AbortError' ? 'timeout' : e.state || 'error';
          const msg = e.name === 'AbortError' ? `No answer within ${Math.round(timeout / 1000)} s` : e.message;
          lastState = state;
          lastMsg = msg;
          attempts.push({ provider: p, model, state, message: msg });
          log(state === 'invalid' || state === 'quota' ? 'info' : 'debug', `${p}/${model} failed (${state}): ${msg}`);
          if (SKIP_PROVIDER.has(state)) break providerLoop; // key problem → next provider
          if (state === 'model') break; // try this provider's next model
          if (!RETRYABLE.has(state) || i === retries) break;
          await sleep(Math.min(8000, 800 * 2 ** i));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    await record(p, lastState || 'error', lastMsg, null);
  }
  const err = new Error(chain.length ? 'All AI providers failed.' : 'No AI key is set.');
  err.code = 'AI_UNAVAILABLE';
  err.status = 503;
  err.attempts = attempts;
  throw err;
}

/* -------- simple in-memory cache (per server instance) -------- */
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
export function cacheClearProduct(productId) {
  for (const k of cache.keys()) if (k.startsWith(`p${productId}:`)) cache.delete(k);
}

/** Status of every provider for Settings. */
export async function providerStatus() {
  const rows = await many('SELECT * FROM ai_status').catch(() => []);
  const order = list('AI_PROVIDER_ORDER').length ? list('AI_PROVIDER_ORDER') : ['openai', 'gemini', 'openrouter', 'anthropic'];
  const keys = [...order.filter((p) => PROVIDERS[p]), ...Object.keys(PROVIDERS).filter((p) => !order.includes(p))];
  return keys.map((p, i) => {
    const r = rows.find((x) => x.provider === p);
    const isSet = configured(p);
    return {
      provider: p, label: PROVIDERS[p].label, keyVar: PROVIDERS[p].keyVar, configured: isSet, position: i + 1,
      models: isSet ? PROVIDERS[p].models() : [],
      state: isSet ? r?.state || 'unknown' : 'not_set',
      stateText: isSet ? (r ? STATE_TEXT[r.state] || r.state : 'Not tested yet') : STATE_TEXT.not_set,
      message: isSet ? r?.message || null : null,
      checked_at: r?.checked_at || null,
      last_ok_at: r?.last_ok_at || null,
    };
  });
}

/** Ping each configured provider with a tiny request. */
export async function testProviders() {
  const out = [];
  for (const p of providerOrder()) {
    try {
      await complete('Reply with a JSON object only.', 'Return {"ok": true}', (t) => {
        if (!/ok/i.test(t)) throw new Error('Unexpected reply');
        return true;
      }, { only: p });
    } catch { /* recorded */ }
  }
  out.push(...(await providerStatus()));
  return out;
}
