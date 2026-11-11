import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { many, one, query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse } from '../util.js';
import { passwordSchema } from './auth.js';

const router = Router();
router.use(requireRole('admin'));

const role = z.enum(['admin', 'manager', 'viewer']);

router.get(
  '/',
  ah(async (req, res) => {
    // ?removed=true lists removed members (history kept); otherwise current members
    const removed = req.query.removed === 'true';
    res.json(
      await many(
        `SELECT id, ${removed ? 'former_email AS email' : 'email'}, notify_email, email_notifications, name, title, can_message_team, role, active,
           last_login_at, created_at, must_change_password, deleted_at
         FROM users WHERE deleted_at IS ${removed ? 'NOT NULL' : 'NULL'} ORDER BY ${removed ? 'deleted_at DESC' : 'created_at'}`
      )
    );
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const body = parse(
      z.object({ email: z.string().email().max(200), notify_email: z.string().trim().email().max(200).or(z.literal('')).optional(), name: z.string().min(1).max(100), title: z.string().trim().max(100).optional(), can_message_team: z.boolean().optional(), role, password: passwordSchema }),
      req.body
    );
    const exists = await one('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (exists) return res.status(409).json({ error: 'A user with this email already exists.' });
    const user = await one(
      'INSERT INTO users (email, notify_email, name, role, password_hash, must_change_password, title, can_message_team) VALUES ($1,$2,$3,$4,$5,$4 = \'admin\',$6,$7) RETURNING id, email, notify_email, name, title, can_message_team, role, active, created_at',
      [body.email.toLowerCase(), body.notify_email ? body.notify_email.toLowerCase() : null, body.name, body.role, await bcrypt.hash(body.password, 12), body.title || null, body.can_message_team ?? false]
    );
    await audit(req, 'user.created', 'user', user.id, { email: user.email, role: user.role });
    res.status(201).json(user);
  })
);

router.patch(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const body = parse(
      z.object({
        name: z.string().min(1).max(100).optional(),
        email: z.string().email().max(200).optional(),
        notify_email: z.string().trim().email().max(200).or(z.literal('')).optional(),
        role: role.optional(),
        title: z.string().trim().max(100).optional(),
        can_message_team: z.boolean().optional(),
        email_notifications: z.boolean().optional(),
        active: z.boolean().optional(),
        password: passwordSchema.optional(),
      }),
      req.body
    );
    if (id === req.user.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      return res.status(400).json({ error: 'You cannot disable or demote your own account.' });
    }
    const current = await one('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!current) return res.status(404).json({ error: 'User not found.' });
    if (body.email && body.email.toLowerCase() !== current.email) {
      const taken = await one('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [body.email, id]);
      if (taken) return res.status(409).json({ error: 'Another user already has this email.' });
    }
    const hash = body.password ? await bcrypt.hash(body.password, 12) : current.password_hash;
    const bump = body.password || body.email || body.active === false || (body.role && body.role !== current.role) ? 1 : 0;
    const user = await one(
      `UPDATE users SET name = $2, role = $3, active = $4, password_hash = $5,
         token_version = token_version + $6, failed_logins = 0, locked_until = NULL, email = $7,
         must_change_password = CASE WHEN $8 THEN TRUE ELSE must_change_password END,
         notify_email = CASE WHEN $9::boolean THEN nullif($10, '') ELSE notify_email END,
         title = CASE WHEN $11::boolean THEN nullif($12, '') ELSE title END,
         can_message_team = coalesce($13, can_message_team),
         email_notifications = coalesce($14, email_notifications)
       WHERE id = $1 RETURNING id, email, notify_email, email_notifications, name, title, can_message_team, role, active, last_login_at, created_at, must_change_password`,
      [id, body.name ?? current.name, body.role ?? current.role, body.active ?? current.active, hash, bump,
        (body.email ?? current.email).toLowerCase(), Boolean(body.password) && id !== req.user.id && (body.role ?? current.role) === 'admin',
        body.notify_email !== undefined, body.notify_email ? body.notify_email.toLowerCase() : null,
        body.title !== undefined, body.title ?? null, body.can_message_team ?? null, body.email_notifications ?? null]
    );
    await audit(req, 'user.updated', 'user', id, { ...body, password: body.password ? '(reset)' : undefined });
    res.json(user);
  })
);

/**
 * Removes a team member: their login stops working at once and the email can be reused,
 * but their messages, tasks, comments, time and reports stay for the admin to see.
 */
router.delete(
  '/:id(\\d+)',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
    const u = await one('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!u) return res.status(404).json({ error: 'Team member not found.' });
    if (u.role === 'admin') {
      const { n } = await one("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active = TRUE AND deleted_at IS NULL AND id <> $1", [id]);
      if (n === 0) return res.status(400).json({ error: 'Keep at least one active admin.' });
    }
    const open = await tx(async (c) => {
      await c.query(
        `UPDATE users SET deleted_at = now(), active = FALSE, token_version = token_version + 1,
           former_email = email, email = $2, notify_email = NULL, email_notifications = FALSE,
           password_hash = $3, can_message_team = FALSE
         WHERE id = $1`,
        [id, `removed-${id}-${crypto.randomBytes(4).toString('hex')}@removed.invalid`, await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)]
      );
      // Stop any running timer, take them off products, clear their pending notices
      await c.query(
        `UPDATE task_time SET ended_at = now(), minutes = GREATEST(1, LEAST(600, round(extract(epoch FROM now() - started_at) / 60)::int))
         WHERE user_id = $1 AND ended_at IS NULL`, [id]);
      await c.query('DELETE FROM product_members WHERE user_id = $1', [id]);
      await c.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      await c.query('DELETE FROM dm_email_state WHERE user_id = $1 OR peer_id = $1', [id]);
      const { rows } = await c.query("SELECT count(*)::int AS n FROM tasks WHERE assigned_to = $1 AND status IN ('todo','in_progress')", [id]);
      return rows[0].n;
    });
    await audit(req, 'user.removed', 'user', id, { email: u.email, name: u.name });
    res.json({ ok: true, openTasks: open });
  })
);

router.get(
  '/audit',
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(
      await many(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.ip, a.created_at, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC LIMIT $1`,
        [limit]
      )
    );
  })
);

export default router;
