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
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/snapshots', requireAuth, snapshotRoutes);
app.use('/api/checklist', requireAuth, checklistRoutes);
app.use('/api/metrics', requireAuth, metricRoutes);
app.use('/api/reviews', requireAuth, reviewRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/files', requireAuth, fileRoutes);
app.use('/api/system', requireAuth, systemRoutes);

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
