import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess } from '../access.js';
import { suggestTasks, productBrief } from '../services/ai.js';
import { STATE_TEXT, providerLabel } from '../services/aiProviders.js';
import { ah, parse } from '../util.js';

/**
 * AI suggestions for one product. Nothing is stored: the admin picks a suggestion,
 * edits it in the task form and sends it. When no AI works, the reply explains why
 * and includes a plain-text product brief to plan from.
 */
const router = Router({ mergeParams: true });
router.use(requireRole('admin'), requireProductAccess());

router.post('/suggest', ah(async (req, res) => {
  const b = parse(z.object({
    goal: z.string().max(1000).optional(),
    count: z.number().int().min(1).max(8).default(5),
    mode: z.enum(['plan', 'followup']).default('plan'),
    refresh: z.boolean().default(false),
  }), req.body || {});
  try {
    const r = await suggestTasks(req.productId, b);
    if (!r.cached) await audit(req, 'ai.suggested', 'product', req.productId, { provider: r.provider, model: r.model, goal: b.goal || null }, req.productId);
    res.json({ ok: true, ...r });
  } catch (e) {
    if (e.code !== 'AI_UNAVAILABLE') throw e;
    const failures = [];
    for (const a of e.attempts || []) {
      const last = failures.find((f) => f.keyId === a.keyId);
      if (last) { if (a.model) last.models.push(a.model); last.state = a.state; last.message = a.message; }
      else failures.push({ keyId: a.keyId, provider: a.provider, label: `${a.label} — ${providerLabel(a.provider)}`, models: a.model ? [a.model] : [], state: a.state, message: a.message });
    }
    const brief = await productBrief(req.productId);
    res.json({
      ok: false,
      reason: (e.attempts || []).length ? 'Every AI key failed for this request.' : 'No AI key has been added yet.',
      failures: failures.map((f) => ({ ...f, stateText: STATE_TEXT[f.state] || f.state })),
      brief: brief.text,
      gaps: brief.gaps,
    });
  }
}));

router.get('/brief', ah(async (req, res) => {
  res.json(await productBrief(req.productId));
}));

export default router;
