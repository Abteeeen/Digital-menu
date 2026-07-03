import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../lib/browser.js';
import { config } from '../config.js';
import { analyzeSite } from '../lib/openrouter.js';

/**
 * Stage 2 — Analysis & Extraction.
 * Screenshots the live site ("before" shot), pulls page metadata (title tag,
 * fonts, colors, text), then runs Vision AI to score the design, extract the
 * full menu + brand, and find one specific quirk to quote on the postcard.
 * Writes out/<slug>/before.png and out/<slug>/analysis.json.
 */
export async function analyze(lead) {
  const dir = path.join(config.outDir, lead.slug);
  await fs.mkdir(dir, { recursive: true });

  console.log(`  scanning ${lead.website} ...`);
  const { screenshot, pageMeta, photoFiles } = await capture(lead.website);
  const beforePath = path.join(dir, 'before.png');
  await fs.writeFile(beforePath, screenshot);

  // Save their real photos as assets for the rebuild.
  const assetsDir = path.join(dir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  for (const p of photoFiles) {
    await fs.writeFile(path.join(assetsDir, `img-${p.index}.${p.ext}`), p.body);
  }
  if (photoFiles.length) console.log(`  saved ${photoFiles.length} photos from their site`);

  const analysis = await analyzeSite({
    screenshotBase64: screenshot.toString('base64'),
    pageMeta,
  });
  analysis.captured_at = new Date().toISOString();
  analysis.low_confidence = !!pageMeta.low_content;
  analysis.qualified = analysis.ugliness_score >= config.uglinessThreshold && !analysis.low_confidence;

  await fs.writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  if (analysis.low_confidence) {
    console.log(
      `  ! ${lead.name}: page still looked near-empty after the retry — extraction is unreliable ` +
        `(likely a slow/JS-rendered page the model had nothing real to read), skipping auto-qualification`
    );
  } else {
    console.log(
      `  ${lead.name}: ugliness ${analysis.ugliness_score}/10 — ${
        analysis.qualified ? 'QUALIFIED' : 'skipped (not ugly enough)'
      }`
    );
  }
  return analysis;
}

const MIN_CONTENT_CHARS = 200;

async function capture(url) {
  const browser = await launchBrowser();
  try {
    // Mobile viewport: we judge (and rebuild) the mobile experience.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000); // let lazy content settle

    let pageMeta = await extractPageMeta(page);

    // Some sites (SPAs, order-ahead widgets, etc.) return a real 200 with a
    // DOM that's still nearly empty at this point — the menu hasn't rendered
    // yet. Handing that to the vision model doesn't fail loudly; it just
    // confidently invents a plausible-looking fake menu. Give it one more,
    // longer, network-idle chance before we trust what we've got.
    if (pageMeta.text.trim().length < MIN_CONTENT_CHARS) {
      console.log('  page looks JS-rendered with little content yet — waiting longer...');
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
      pageMeta = await extractPageMeta(page);
    }
    pageMeta.low_content = pageMeta.text.trim().length < MIN_CONTENT_CHARS;

    // Download the candidate photos so the rebuilt app can embed them.
    const photoFiles = [];
    for (const p of pageMeta.photos) {
      try {
        const resp = await page.request.get(p.src, { timeout: 15000 });
        if (!resp.ok()) continue;
        const ct = resp.headers()['content-type'] || '';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
        photoFiles.push({ index: p.index, ext, body: await resp.body(), src: p.src, alt: p.alt });
      } catch {}
    }

    const screenshot = await page.screenshot({ fullPage: true });
    return { screenshot, pageMeta, photoFiles };
  } finally {
    await browser.close();
  }
}

async function extractPageMeta(page) {
  return page.evaluate(() => {
    const styles = new Set();
    const colors = new Set();
    document.querySelectorAll('h1,h2,h3,p,a,button,body').forEach((el) => {
      const cs = getComputedStyle(el);
      styles.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      colors.add(cs.color);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(cs.backgroundColor);
    });
    // Real content photos only: big enough to be food/interior shots,
    // not logos, icons, or tracking pixels.
    const photos = [...document.images]
      .filter((i) => i.naturalWidth >= 250 && i.naturalHeight >= 180 && i.src.startsWith('http'))
      .filter((i) => !/logo|icon|sprite|badge|payment/i.test(i.src + ' ' + (i.alt || '')))
      .slice(0, 16)
      .map((i, idx) => ({ index: idx, src: i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight }));
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      fonts: [...styles].slice(0, 8),
      colors: [...colors].slice(0, 15),
      favicon: !!document.querySelector('link[rel*="icon"]'),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000),
      photos,
    };
  });
}
