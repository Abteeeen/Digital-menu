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
  const { screenshot, pageMeta } = await capture(lead.website);
  const beforePath = path.join(dir, 'before.png');
  await fs.writeFile(beforePath, screenshot);

  const analysis = await analyzeSite({
    screenshotBase64: screenshot.toString('base64'),
    pageMeta,
  });
  analysis.captured_at = new Date().toISOString();
  analysis.qualified = analysis.ugliness_score >= config.uglinessThreshold;

  await fs.writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  console.log(
    `  ${lead.name}: ugliness ${analysis.ugliness_score}/10 — ${
      analysis.qualified ? 'QUALIFIED' : 'skipped (not ugly enough)'
    }`
  );
  return analysis;
}

async function capture(url) {
  const browser = await launchBrowser();
  try {
    // Mobile viewport: we judge (and rebuild) the mobile experience.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000); // let lazy content settle

    const pageMeta = await page.evaluate(() => {
      const styles = new Set();
      const colors = new Set();
      document.querySelectorAll('h1,h2,h3,p,a,button,body').forEach((el) => {
        const cs = getComputedStyle(el);
        styles.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
        colors.add(cs.color);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(cs.backgroundColor);
      });
      return {
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || '',
        fonts: [...styles].slice(0, 8),
        colors: [...colors].slice(0, 15),
        favicon: !!document.querySelector('link[rel*="icon"]'),
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000),
        images: [...document.images].slice(0, 12).map((i) => i.src),
      };
    });

    const screenshot = await page.screenshot({ fullPage: true });
    return { screenshot, pageMeta };
  } finally {
    await browser.close();
  }
}
