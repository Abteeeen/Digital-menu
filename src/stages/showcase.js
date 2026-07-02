import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../lib/browser.js';
import { config } from '../config.js';

/**
 * Stage 6 — Showcase.
 * Renders the Menubly-style presentation frame: BEFORE screenshot of their
 * ugly site → AFTER phone mock of the generated app → the postcard, on a dark
 * terminal-styled canvas. Output: out/<slug>/showcase.png (1920x1080).
 */
export async function showcase(lead, analysis, postcard) {
  const dir = path.join(config.outDir, lead.slug);

  const beforeB64 = await fileB64(path.join(dir, 'before.png'));
  const appHtml = await fs.readFile(path.join(dir, 'app', 'index.html'), 'utf8');
  const qrB64 = await fileB64(path.join(dir, 'qr.png'));

  const itemCount = (analysis.menu?.categories || []).reduce((n, c) => n + c.items.length, 0);
  const catCount = (analysis.menu?.categories || []).length;

  let tpl = await fs.readFile(path.join(config.templatesDir, 'showcase.html'), 'utf8');
  tpl = tpl
    .replaceAll('{{RESTAURANT}}', esc(analysis.brand.name))
    .replaceAll('{{TAGLINE}}', esc(analysis.brand.tagline || ''))
    .replaceAll('{{QUIRK}}', esc(analysis.quirk))
    .replaceAll('{{VERDICT}}', esc(analysis.verdict || ''))
    .replaceAll('{{SCORE}}', String(analysis.ugliness_score))
    .replaceAll('{{ITEMS}}', String(itemCount))
    .replaceAll('{{CATS}}', String(catCount))
    .replaceAll('{{HEADLINE}}', esc(postcard.headline))
    .replaceAll('{{BODY}}', esc(postcard.body))
    .replaceAll('{{SIGNOFF}}', esc(postcard.signoff))
    .replaceAll('{{FROM_NAME}}', esc(config.from.name))
    .replaceAll('{{BEFORE_B64}}', beforeB64)
    .replaceAll('{{QR_B64}}', qrB64)
    .replaceAll('{{APP_SRCDOC}}', appHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));

  const showcasePath = path.join(dir, 'showcase.html');
  await fs.writeFile(showcasePath, tpl);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    });
    await page.goto('file://' + showcasePath, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const out = path.join(dir, 'showcase.png');
    await page.screenshot({ path: out });
    console.log(`  showcase rendered: out/${lead.slug}/showcase.png`);
    return out;
  } finally {
    await browser.close();
  }
}

async function fileB64(p) {
  return (await fs.readFile(p)).toString('base64');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
