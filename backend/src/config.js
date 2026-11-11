// Central configuration. Every secret comes from environment variables
// (Railway "Variables" tab) — nothing sensitive is ever stored in the repo.

function required(name, { minLength = 1 } = {}) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    console.error(
      `\n[config] Missing or too-short environment variable: ${name}` +
        (minLength > 1 ? ` (needs at least ${minLength} characters)` : '') +
        `\n         See backend/.env.example and README.md.\n`
    );
    process.exit(1);
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', { minLength: 32 }),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  // 32-byte key, hex (64 chars). Used for AES-256-GCM field + backup encryption.
  encryptionKey: required('ENCRYPTION_KEY', { minLength: 64 }),
  // Comma-separated list of allowed frontend origins, e.g. https://growth.vercel.app
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  // First-run admin (only used when the users table is empty)
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME || 'Owner',
  // Cloudflare R2 (S3-compatible). Optional — file uploads & cloud backups are
  // disabled until these are set.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  },
  backupCron: process.env.BACKUP_CRON || '0 2 * * *',
  timezone: process.env.APP_TIMEZONE || 'Asia/Karachi',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
};

export const r2Enabled = Boolean(
  config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket
);
