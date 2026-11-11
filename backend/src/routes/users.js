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
        'SELECT id, email, name, role, active, last_login_at, created_at FROM users ORDER BY created_at'
      )
    );
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const body = parse(
      z.object({ email: z.string().email().max(200), name: z.string().min(1).max(100), role, password: passwordSchema }),
      req.body
    );
    const exists = await one('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (exists) return res.status(409).json({ error: 'A user with this email already exists.' });
    const user = await one(
      'INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, active, created_at',
      [body.email.toLowerCase(), body.name, body.role, await bcrypt.hash(body.password, 12)]
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
        role: role.optional(),
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
    const hash = body.password ? await bcrypt.hash(body.password, 12) : current.password_hash;
    const bump = body.password || body.active === false || (body.role && body.role !== current.role) ? 1 : 0;
    const user = await one(
      `UPDATE users SET name = $2, role = $3, active = $4, password_hash = $5,
         token_version = token_version + $6, failed_logins = 0, locked_until = NULL
       WHERE id = $1 RETURNING id, email, name, role, active, last_login_at, created_at`,
      [id, body.name ?? current.name, body.role ?? current.role, body.active ?? current.active, hash, bump]
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
