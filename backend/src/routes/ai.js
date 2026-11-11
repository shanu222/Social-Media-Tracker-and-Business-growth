import { Router } from 'express';
import { z } from 'zod';
import { tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { requireProductAccess } from '../access.js';
import { suggestTasks } from '../services/ai.js';
import { ah, parse } from '../util.js';

/** AI drafts tasks for one product. Drafts stay invisible to the team until the admin sends them. */
const router = Router({ mergeParams: true });
router.use(requireRole('admin'), requireProductAccess());

router.post('/suggest', ah(async (req, res) => {
  const b = parse(z.object({
    goal: z.string().max(1000).optional(),
    count: z.number().int().min(1).max(10).default(5),
    mode: z.enum(['plan', 'followup']).default('plan'),
  }), req.body || {});
  const result = await suggestTasks(req.productId, b);
  const drafts = await tx(async (c) => {
    const out = [];
    for (const t of result.tasks) {
      const { rows } = await c.query(
        `INSERT INTO tasks (product_id, kind, title, description, instructions, caption, hashtags, platforms, priority,
           start_date, due_date, status, ai_generated, ai_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',TRUE,$12,$13) RETURNING id, title`,
        [req.productId, t.kind, t.title, t.description, t.instructions, t.caption, t.hashtags, t.platforms, t.priority,
          t.start_date, t.due_date, t.reason, req.user.id]
      );
      out.push(rows[0]);
    }
    return out;
  });
  await audit(req, 'ai.suggested', 'product', req.productId, { drafts: drafts.length, goal: b.goal || null }, req.productId);
  res.json({ summary: result.summary, gaps: result.gaps, drafts });
}));

export default router;
