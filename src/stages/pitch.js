import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { writePostcard } from '../lib/openrouter.js';

/**
 * Stage 4 — The Pitch.
 * Generates the QR code for the live menu app and the postcard copy that
 * quotes the restaurant's specific quirk. Renders print-ready postcard HTML
 * (front + back, 6.25x4.25in with bleed, Lob-compatible).
 * Writes out/<slug>/qr.png, postcard.json, postcard-front.html, postcard-back.html.
 */
export async function pitch(lead, analysis, rebuildResult, { demo = false } = {}) {
  const dir = path.join(config.outDir, lead.slug);

  const qrPath = path.join(dir, 'qr.png');
  await QRCode.toFile(qrPath, rebuildResult.url, {
    width: 600,
    margin: 1,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  });
  const qrDataUrl = await QRCode.toDataURL(rebuildResult.url, { width: 600, margin: 1 });

  let copy;
  if (demo) {
    copy = {
      headline: 'I rebuilt your menu.',
      body: `${analysis.quirk} The restaurant deserves better — so I gave your menu a new home and a real name. It's live right now, free, and all yours. Scan the QR and take a look.`,
    };
  } else {
    copy = await writePostcard({
      restaurant: analysis.brand.name,
      quirk: analysis.quirk,
      fromName: config.from.name,
    });
  }

  const postcard = {
    to: { name: `Owner, ${analysis.brand.name}`, address: lead.address },
    headline: copy.headline,
    body: copy.body,
    signoff: `— ${config.from.name}`,
    url: rebuildResult.url,
    quirk: analysis.quirk,
  };
  await fs.writeFile(path.join(dir, 'postcard.json'), JSON.stringify(postcard, null, 2));

  // Render print-ready HTML for Lob (it accepts raw HTML for front/back).
  for (const side of ['front', 'back']) {
    let tpl = await fs.readFile(path.join(config.templatesDir, `postcard-${side}.html`), 'utf8');
    tpl = tpl
      .replaceAll('{{HEADLINE}}', esc(postcard.headline))
      .replaceAll('{{BODY}}', esc(postcard.body))
      .replaceAll('{{SIGNOFF}}', esc(postcard.signoff))
      .replaceAll('{{RESTAURANT}}', esc(analysis.brand.name))
      .replaceAll('{{URL}}', esc(postcard.url))
      .replaceAll('{{QR_DATA_URL}}', qrDataUrl)
      .replaceAll('{{PRIMARY}}', analysis.brand.primary_color || '#b33a2e')
      .replaceAll('{{FROM_NAME}}', esc(config.from.name));
    await fs.writeFile(path.join(dir, `postcard-${side}.html`), tpl);
  }

  console.log(`  pitch ready: "${postcard.headline}" + QR -> ${rebuildResult.url}`);
  return postcard;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
