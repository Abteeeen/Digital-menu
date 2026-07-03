import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * A durable, human-reviewable ledger of every restaurant the pipeline has
 * touched (discovered and/or analyzed), stored as CSV in the repo — unlike
 * out/, which is gitignored and wiped between runs. Lets a human eyeball
 * results across runs and tell us which sites/scores/layouts were actually
 * good calls.
 */
const CSV_PATH = path.join(config.dataDir, 'leads.csv');

const COLUMNS = [
  'slug',
  'name',
  'website',
  'city',
  'state',
  'cuisine',
  'source',
  'discovered_at',
  'analyzed_at',
  'ugliness_score',
  'qualified',
  'low_confidence',
  'layout',
  'quirk',
  'review',
  'notes',
];

function escapeCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cell += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toRowObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || r[0] !== '').map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
}

export async function readLeads() {
  try {
    const text = await fs.readFile(CSV_PATH, 'utf8');
    return toRowObjects(parseCsv(text));
  } catch {
    return [];
  }
}

export async function writeLeads(rows) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => escapeCell(row[c])).join(','));
  }
  await fs.writeFile(CSV_PATH, lines.join('\n') + '\n');
}

/** Merge partial fields into the row for `slug`, creating it if new. Never touches review/notes unless explicitly passed. */
export async function upsertLead(partial) {
  if (!partial.slug) throw new Error('upsertLead requires a slug');
  const rows = await readLeads();
  const existing = rows.find((r) => r.slug === partial.slug);
  if (existing) {
    Object.assign(existing, partial);
  } else {
    const blank = Object.fromEntries(COLUMNS.map((c) => [c, '']));
    rows.push({ ...blank, ...partial });
  }
  await writeLeads(rows);
}
