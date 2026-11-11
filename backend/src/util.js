import { z } from 'zod';
import { config } from './config.js';

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse with zod; on failure respond 400 with a readable message. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.') || 'input';
    const err = new Error(`${field}: ${issue.message}`);
    err.status = 400;
    throw err;
  }
  return result.data;
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, 'use YYYY-MM');
export const zInt = z.coerce.number().int().min(0).max(2_000_000_000);
export const zOptInt = z
  .union([z.literal(''), z.null(), z.undefined(), zInt])
  .transform((v) => (v === '' || v === undefined ? null : v));

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO week key, e.g. 2026-W46 */
export function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Monday of the week containing dateStr */
export function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;
  return addDays(dateStr, 1 - day);
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function periodKey(frequency, dateStr) {
  if (frequency === 'daily') return dateStr;
  if (frequency === 'weekly') return isoWeekKey(dateStr);
  return dateStr.slice(0, 7);
}
