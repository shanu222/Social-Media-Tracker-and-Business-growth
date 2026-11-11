import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db.js';
import { hideSecurityFromNonAdmins } from './adminOnly.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, v: user.token_version, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
    issuer: 'growth-desk',
  });
}

/** Verifies the bearer token AND re-checks the user in the DB on every request,
 *  so disabling a user or "sign out everywhere" takes effect immediately. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'growth-desk' });
    const user = await one(
      'SELECT id, email, name, title, role, active, token_version, must_change_password, can_message_team FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!user || !user.active || user.token_version !== payload.v) {
      return res.status(401).json({ error: 'Your session has ended. Sign in again.' });
    }
    req.user = user;
    return hideSecurityFromNonAdmins(req, res, next);
  } catch {
    return res.status(401).json({ error: 'Your session has ended. Sign in again.' });
  }
}

const RANK = { viewer: 0, manager: 1, admin: 2 };

/** requireRole('manager') allows manager + admin. */
export function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user || RANK[req.user.role] < RANK[minRole]) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}
