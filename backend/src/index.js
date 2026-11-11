import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import { config } from './config.js';
import { pool, one } from './db.js';
import { migrate } from './migrate.js';
import { requireAuth } from './auth.js';
import { runBackup } from './services/backup.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import accountRoutes from './routes/accounts.js';
import snapshotRoutes from './routes/snapshots.js';
import checklistRoutes from './routes/checklist.js';
import metricRoutes from './routes/metrics.js';
import reviewRoutes from './routes/reviews.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import fileRoutes from './routes/files.js';
import systemRoutes from './routes/system.js';
import productRoutes from './routes/products.js';
import { productTasks, globalTasks, sendDueReminders } from './routes/tasks.js';
import libraryRoutes from './routes/library.js';
import aiRoutes from './routes/ai.js';
import postRoutes from './routes/posts.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import { syncAll } from './services/sync.js';
import { importEnvKeys } from './services/aiProviders.js';

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);
app.use(
  cors({
    origin(origin, cb) {
      // Allow server-to-server / curl (no Origin) and the configured frontends only
      if (!origin || config.corsOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT || 300),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again.' },
  })
);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRoutes);

// Everything below needs a signed-in user who has replaced their first password.
function requireFreshPassword(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(403).json({ error: 'Change your password to continue.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}
const auth = [requireAuth, requireFreshPassword];
app.use('/api/products/:productId(\\d+)/tasks', auth, productTasks);
app.use('/api/products/:productId(\\d+)/posts', auth, postRoutes);
app.use('/api/products/:productId(\\d+)/messages', auth, messageRoutes);
app.use('/api/products/:productId(\\d+)/library', auth, libraryRoutes);
app.use('/api/products/:productId(\\d+)/ai', auth, aiRoutes);
app.use('/api/products', auth, productRoutes);
app.use('/api/tasks', auth, globalTasks);
app.use('/api/notifications', auth, notificationRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/accounts', auth, accountRoutes);
app.use('/api/snapshots', auth, snapshotRoutes);
app.use('/api/checklist', auth, checklistRoutes);
app.use('/api/metrics', auth, metricRoutes);
app.use('/api/reviews', auth, reviewRoutes);
app.use('/api/dashboard', auth, dashboardRoutes);
app.use('/api/reports', auth, reportRoutes);
app.use('/api/files', auth, fileRoutes);
app.use('/api/system', auth, systemRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error:
      status === 413
        ? `File is larger than ${config.maxUploadMb} MB.`
        : status >= 500
        ? 'Something went wrong on the server. Try again; if it keeps happening, check the Railway logs.'
        : err.message,
  });
});

/** Creates the Social Media Manager login from MANAGER_* variables (once). Forced password change on first sign-in. */
async function bootstrapManager() {
  const email = process.env.MANAGER_EMAIL?.trim().toLowerCase();
  const password = process.env.MANAGER_PASSWORD;
  if (!email || !password) return;
  const exists = await one('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (exists) return;
  await one(
    'INSERT INTO users (email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,TRUE) RETURNING id',
    [email, process.env.MANAGER_NAME || 'Social Media Manager', 'manager', await bcrypt.hash(password, 12)]
  );
  console.log(`[setup] Created Social Media Manager login ${email} (must change password on first sign-in).`);
}

/** ADMIN_NOTIFY_EMAIL / MANAGER_NOTIFY_EMAIL fill in notification addresses once (UI changes win afterwards). */
async function bootstrapNotifyEmails() {
  const pairs = [
    [process.env.ADMIN_EMAIL, process.env.ADMIN_NOTIFY_EMAIL, process.env.ADMIN_NAME],
    [process.env.MANAGER_EMAIL, process.env.MANAGER_NOTIFY_EMAIL, process.env.MANAGER_NAME],
  ];
  for (const [login, notifyTo, name] of pairs) {
    if (!login || !notifyTo) continue;
    const u = await one(
      `UPDATE users SET notify_email = lower($2), name = CASE WHEN name IN ('Owner', 'Social Media Manager') AND $3::text IS NOT NULL THEN $3 ELSE name END
       WHERE lower(email) = lower($1) AND notify_email IS NULL RETURNING email`,
      [login.trim(), notifyTo.trim(), name || null]
    );
    if (u) console.log(`[setup] Notifications for ${u.email} will go to ${notifyTo}`);
  }
}

async function bootstrapAdmin() {
  const { n } = await one('SELECT count(*)::int AS n FROM users');
  if (n > 0) return;
  if (!config.adminEmail || !config.adminPassword || config.adminPassword.length < 10) {
    console.warn('[setup] No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) to create the first admin.');
    return;
  }
  await one('INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id', [
    config.adminEmail.toLowerCase(),
    config.adminName,
    'admin',
    await bcrypt.hash(config.adminPassword, 12),
  ]);
  console.log(`[setup] Created first admin ${config.adminEmail}. You can now remove ADMIN_PASSWORD from Railway variables.`);
}

async function start() {
  await migrate();
  await bootstrapAdmin();
  await bootstrapManager();
  await bootstrapNotifyEmails();
  await importEnvKeys().catch((e) => console.error('[ai] env import failed', e.message));
  const tz = { timezone: config.timezone };
  // Pull follower counts from official APIs every 6 hours
  cron.schedule(process.env.SYNC_CRON || '15 */6 * * *', () =>
    syncAll().then((r) => console.log('[sync]', r)).catch((e) => console.error('[sync] failed', e.message)), tz);
  // Deadline reminders every morning
  cron.schedule(process.env.REMINDER_CRON || '0 9 * * *', () =>
    sendDueReminders().then((n) => console.log('[reminders]', n)).catch((e) => console.error('[reminders] failed', e.message)), tz);
  if (cron.validate(config.backupCron)) {
    cron.schedule(
      config.backupCron,
      () => runBackup('scheduled').then((r) => console.log('[backup]', r.skipped ? r.reason : r.storage_key)).catch((e) => console.error('[backup] failed', e.message)),
      { timezone: config.timezone }
    );
  }
  app.listen(config.port, () => console.log(`Growth Desk API listening on :${config.port}`));
}

start().catch((e) => {
  console.error('Failed to start', e);
  process.exit(1);
});
