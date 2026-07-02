#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { discover } from './stages/discover.js';
import { analyze } from './stages/analyze.js';
import { rebuild } from './stages/rebuild.js';
import { pitch } from './stages/pitch.js';
import { fulfill } from './stages/fulfill.js';
import { showcase } from './stages/showcase.js';

const [, , cmd = 'help', ...rest] = process.argv;
const flags = Object.fromEntries(
  rest.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);
const args = rest.filter((a) => !a.startsWith('--'));

async function loadLead(slug) {
  const p = path.join(config.outDir, slug, 'lead.json');
  return JSON.parse(await fs.readFile(p, 'utf8'));
}
async function loadJson(slug, file) {
  return JSON.parse(await fs.readFile(path.join(config.outDir, slug, file), 'utf8'));
}
async function allLeads() {
  const entries = await fs.readdir(config.outDir, { withFileTypes: true }).catch(() => []);
  const leads = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      leads.push(await loadLead(e.name));
    } catch {}
  }
  return leads;
}

/** Full pipeline for one lead. Returns true if it went all the way through. */
async function processLead(lead, { demo = false, mail = false } = {}) {
  console.log(`\n=== ${lead.name} ===`);
  let analysis;
  if (demo) {
    analysis = await loadJson(lead.slug, 'analysis.json');
    console.log(`  (demo) ugliness ${analysis.ugliness_score}/10 — QUALIFIED`);
  } else {
    analysis = await analyze(lead);
    if (!analysis.qualified) return false;
  }
  const built = await rebuild(lead, analysis);
  const card = await pitch(lead, analysis, built, { demo });
  if (mail) await fulfill(lead, card);
  else console.log('  (mail skipped — pass --mail to send via Lob)');
  await showcase(lead, analysis, card);
  return true;
}

const commands = {
  async discover() {
    await discover({
      query: flags.query || 'restaurants',
      city: flags.city || 'Austin, TX',
      limit: Number(flags.limit || 10),
    });
  },

  async analyze() {
    const leads = args[0] ? [await loadLead(args[0])] : await allLeads();
    for (const lead of leads) await analyze(lead);
  },

  async rebuild() {
    const lead = await loadLead(args[0]);
    await rebuild(lead, await loadJson(args[0], 'analysis.json'));
  },

  async pitch() {
    const lead = await loadLead(args[0]);
    await pitch(lead, await loadJson(args[0], 'analysis.json'), await loadJson(args[0], 'rebuild.json'), {
      demo: !!flags.demo,
    });
  },

  async fulfill() {
    const lead = await loadLead(args[0]);
    await fulfill(lead, await loadJson(args[0], 'postcard.json'));
  },

  async showcase() {
    const lead = await loadLead(args[0]);
    await showcase(lead, await loadJson(args[0], 'analysis.json'), await loadJson(args[0], 'postcard.json'));
  },

  /** End-to-end run. --demo uses the bundled Kiyomi fixture (no API keys needed). */
  async run() {
    if (flags.demo) {
      const demoSrc = path.join(config.dataDir, 'demo');
      const lead = JSON.parse(await fs.readFile(path.join(demoSrc, 'lead.json'), 'utf8'));
      const dir = path.join(config.outDir, lead.slug);
      await fs.mkdir(dir, { recursive: true });
      for (const f of ['lead.json', 'analysis.json', 'before.png']) {
        await fs.copyFile(path.join(demoSrc, f), path.join(dir, f));
      }
      await fs.cp(path.join(demoSrc, 'assets'), path.join(dir, 'assets'), { recursive: true, force: true });
      await processLead(lead, { demo: true, mail: !!flags.mail });
      console.log(`\nDemo complete. Open out/${lead.slug}/showcase.png`);
      return;
    }
    const leads = await discover({
      query: flags.query || 'restaurants',
      city: flags.city || 'Austin, TX',
      limit: Number(flags.limit || 10),
    });
    let hits = 0;
    for (const lead of leads) {
      try {
        if (await processLead(lead, { mail: !!flags.mail })) hits++;
      } catch (err) {
        console.error(`  ! ${lead.name} failed: ${err.message}`);
      }
    }
    console.log(`\nPipeline done: ${hits}/${leads.length} menus rebuilt. See out/`);
  },

  help() {
    console.log(`plate-pixel — find ugly restaurant menus, rebuild them, mail the owner a QR postcard

Usage:
  node src/index.js run [--city="Austin, TX"] [--query=restaurants] [--limit=10] [--mail]
  node src/index.js run --demo            end-to-end with bundled fixture, no API keys
  node src/index.js discover [--city=..] [--limit=..]
  node src/index.js analyze [slug]        screenshot + Vision AI score/extract
  node src/index.js rebuild <slug>        generate + deploy the menu app
  node src/index.js pitch <slug>          QR + postcard copy + print HTML
  node src/index.js fulfill <slug>        send to Lob
  node src/index.js showcase <slug>       render the before/after/postcard frame

Keys go in .env (see .env.example). --mail is required to actually send postcards.`);
  },
};

const fn = commands[cmd] || commands.help;
fn().catch((err) => {
  console.error(err);
  process.exit(1);
});
