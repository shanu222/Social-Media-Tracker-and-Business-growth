import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse } from '../util.js';
import { passwordSchema } from './auth.js';

const router = Router();
router.use(requireRole('admin'));

const role = z.enum(['admin', 'manager', 'viewer']);

router.get(
  '/',
  ah(async (_req, res) => {
    res.json(
      await many(
        'SELECT id, email, notify_email, email_notifications, name, title, can_message_team, role, active, last_login_at, created_at, must_change_password FROM users ORDER BY created_at'
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
        active: z.boolean().optional(),
        password: passwordSchema.optional(),
      }),
      req.body
    );
    if (id === req.user.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      return res.status(400).json({ error: 'You cannot disable or demote your own account.' });
    }
    const current = await one('SELECT * FROM users WHERE id = $1', [id]);
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
         can_message_team = coalesce($13, can_message_team)
       WHERE id = $1 RETURNING id, email, notify_email, name, title, can_message_team, role, active, last_login_at, created_at, must_change_password`,
      [id, body.name ?? current.name, body.role ?? current.role, body.active ?? current.active, hash, bump,
        (body.email ?? current.email).toLowerCase(), Boolean(body.password) && id !== req.user.id && (body.role ?? current.role) === 'admin',
        body.notify_email !== undefined, body.notify_email ? body.notify_email.toLowerCase() : null,
        body.title !== undefined, body.title ?? null, body.can_message_team ?? null]
    );
    await audit(req, 'user.updated', 'user', id, { ...body, password: body.password ? '(reset)' : undefined });
    res.json(user);
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
