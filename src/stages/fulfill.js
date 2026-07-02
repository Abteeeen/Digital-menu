import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Stage 5 — Fulfillment.
 * Sends the rendered postcard HTML to Lob's Postcards API to be printed and
 * mailed to the restaurant's address. Uses whatever key is in LOB_API_KEY —
 * use a test_ key to dry-run for free.
 * Writes out/<slug>/fulfillment.json.
 */
export async function fulfill(lead, postcard) {
  const dir = path.join(config.outDir, lead.slug);

  if (!config.lobKey) {
    console.log('  no LOB_API_KEY — skipping mail. Postcard HTML is in out/' + lead.slug);
    return { skipped: true };
  }
  const addr = lead.address || {};
  if (!addr.line1 || !addr.city || !addr.state || !addr.zip) {
    console.log(`  ${lead.name}: incomplete mailing address, skipping fulfillment`);
    return { skipped: true, reason: 'incomplete address' };
  }

  const front = await fs.readFile(path.join(dir, 'postcard-front.html'), 'utf8');
  const back = await fs.readFile(path.join(dir, 'postcard-back.html'), 'utf8');

  const form = new URLSearchParams({
    description: `Menu rebuild pitch — ${lead.name}`,
    size: '4x6',
    front,
    back,
    'to[name]': postcard.to.name.slice(0, 40),
    'to[address_line1]': addr.line1,
    'to[address_city]': addr.city,
    'to[address_state]': addr.state,
    'to[address_zip]': addr.zip,
    'from[name]': config.from.name,
    'from[company]': config.from.company,
    'from[address_line1]': config.from.address_line1,
    'from[address_city]': config.from.address_city,
    'from[address_state]': config.from.address_state,
    'from[address_zip]': config.from.address_zip,
  });

  const res = await fetch('https://api.lob.com/v1/postcards', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(config.lobKey + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Lob ${res.status}: ${JSON.stringify(data)}`);

  const result = {
    lob_id: data.id,
    expected_delivery_date: data.expected_delivery_date,
    mode: config.lobKey.startsWith('test_') ? 'test' : 'LIVE',
    preview_url: data.url,
  };
  await fs.writeFile(path.join(dir, 'fulfillment.json'), JSON.stringify(result, null, 2));
  console.log(`  mailed via Lob (${result.mode}): ${data.id}, ETA ${data.expected_delivery_date}`);
  return result;
}
