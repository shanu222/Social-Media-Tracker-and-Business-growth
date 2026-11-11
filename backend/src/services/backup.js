import zlib from 'node:zlib';
import { many, one } from '../db.js';
import { encryptBuffer } from '../crypto.js';
import { storageEnabled, putObject } from '../storage.js';

const TABLES = [
  'accounts', 'snapshots', 'checklist_tasks', 'checklist_completions', 'metrics', 'metric_entries',
  'metric_targets', 'account_reviews', 'monthly_summaries', 'action_items', 'files', 'reports',
];

/** Dumps business tables to JSON, gzips, encrypts with ENCRYPTION_KEY and stores in R2.
 *  User password hashes are deliberately excluded. */
export async function runBackup(trigger = 'scheduled') {
  if (!storageEnabled) return { skipped: true, reason: 'Cloud storage not configured' };
  const dump = { version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await many(`SELECT * FROM ${t}`);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump)));
  const enc = encryptBuffer(gz);
  const key = `backups/${dump.created_at.slice(0, 10)}-${Date.now()}.json.gz.enc`;
  await putObject(key, enc, 'application/octet-stream');
  const row = await one('INSERT INTO backups (storage_key, size, trigger) VALUES ($1,$2,$3) RETURNING *', [key, enc.length, trigger]);
  return row;
}
