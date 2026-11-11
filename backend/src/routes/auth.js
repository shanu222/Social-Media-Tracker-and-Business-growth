import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { ah, parse } from '../util.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

export const passwordSchema = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'must contain letters and numbers');

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash so unknown emails take the same time as wrong passwords
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

router.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(
      z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }),
      req.body
    );
    const user = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(429).json({ error: 'This account is locked after too many failed attempts. Try again in 15 minutes.' });
    }
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.active) {
      if (user) {
        const fails = user.failed_logins + 1;
        await query(
          `UPDATE users SET failed_logins = $2,
             locked_until = CASE WHEN $2 >= ${MAX_FAILS} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE NULL END
           WHERE id = $1`,
          [user.id, fails >= MAX_FAILS ? 0 : fails]
        );
        await audit({ user: { id: user.id }, ip: req.ip }, 'login.failed', 'user', user.id);
      }
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    await audit({ user, ip: req.ip }, 'login.success', 'user', user.id);
    res.json({
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, must_change_password: user.role === 'admin' && user.must_change_password },
    });
  })
);

router.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const u = await one('SELECT id, email, name, role, must_change_password, email_notifications, notify_email FROM users WHERE id = $1', [req.user.id]);
    res.json({ user: { ...u, must_change_password: u.role === 'admin' && u.must_change_password } });
  })
);

router.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    // Passwords are company-controlled: only admins change passwords (their own here, others in Team).
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
    const { currentPassword, newPassword } = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      req.body
    );
    const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Choose a password different from the current one.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const updated = await one(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1, must_change_password = FALSE WHERE id = $1 RETURNING *',
      [user.id, hash]
    );
    await audit(req, 'user.password_changed', 'user', user.id);
    res.json({ token: signToken(updated) });
  })
);

/** Personal preference: receive emails or in-app only. */
router.patch(
  '/preferences',
  requireAuth,
  ah(async (req, res) => {
    const b = parse(z.object({
      email_notifications: z.boolean().optional(),
      notify_email: z.string().trim().email().max(200).or(z.literal('')).optional(),
    }), req.body);
    // Changing where emails go is an admin-only setting (managers' addresses are managed by the admin).
    if (b.notify_email !== undefined && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    await query(
      `UPDATE users SET email_notifications = coalesce($2, email_notifications),
         notify_email = CASE WHEN $3::boolean THEN nullif($4, '') ELSE notify_email END WHERE id = $1`,
      [req.user.id, b.email_notifications ?? null, b.notify_email !== undefined, b.notify_email ?? null]
    );
    if (b.notify_email !== undefined) await audit(req, 'user.notify_email_changed', 'user', req.user.id);
    res.json({ ok: true });
  })
);

/** Invalidates every token issued for this user (all devices). */
router.post(
  '/logout-all',
  requireAuth,
  ah(async (req, res) => {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    await audit(req, 'user.logout_all', 'user', req.user.id);
    res.json({ ok: true });
  })
);

export default router;
