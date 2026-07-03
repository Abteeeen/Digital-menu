import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../lib/browser.js';
import { config } from '../config.js';
import { analyzeSite } from '../lib/openrouter.js';
import { upsertLead } from '../lib/leads.js';

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

  // Bot-challenge/error pages (Cloudflare "Just a moment...", 4xx/5xx) can't
  // yield a real menu no matter how good the vision model is — burning an
  // API call scoring a screenshot of a challenge page is pure waste. Bail
  // with a minimal, clearly-flagged result before ever calling analyzeSite().
  if (pageMeta.block_reason) {
    const analysis = {
      captured_at: new Date().toISOString(),
      skip_reason: pageMeta.block_reason,
      low_confidence: true,
      qualified: false,
      ugliness_score: null,
      layout: null,
      brand: {},
      menu: { categories: [] },
    };
    await fs.writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
    await upsertLead({
      slug: lead.slug,
      name: lead.name,
      website: lead.website,
      analyzed_at: analysis.captured_at,
      qualified: false,
      low_confidence: true,
      skip_reason: analysis.skip_reason,
    });
    console.log(`  ! ${lead.name}: site returned a bot-challenge/error page (${pageMeta.block_reason}) — skipping vision analysis`);
    return analysis;
  }

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
  analysis.skip_reason = pageMeta.low_content && pageMeta.pdf_menu_signal ? 'pdf_only_menu' : null;
  analysis.qualified = analysis.ugliness_score >= config.uglinessThreshold && !analysis.low_confidence;
  analysis.layout = pickLayout(pageMeta.photos.length, analysis.layout);

  await fs.writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  await upsertLead({
    slug: lead.slug,
    name: lead.name,
    website: lead.website,
    cuisine: analysis.brand?.cuisine || '',
    analyzed_at: analysis.captured_at,
    ugliness_score: analysis.ugliness_score,
    qualified: analysis.qualified,
    low_confidence: analysis.low_confidence,
    skip_reason: analysis.skip_reason || '',
    layout: analysis.layout || '',
    quirk: analysis.quirk || '',
  });
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
const VALID_LAYOUTS = ['grid-card', 'list-ledger', 'magazine-split'];
const BLOCK_TITLE_RE = /just a moment|attention required|checking your browser|please verify|are you (a )?human|access denied|request blocked/i;

/** Sites behind bot-challenge walls (Cloudflare, etc.) or returning an HTTP
 * error can't yield a real menu — detect it so we skip the vision call. */
function detectBlockReason(status, title, text) {
  if (BLOCK_TITLE_RE.test(title || '') || BLOCK_TITLE_RE.test((text || '').slice(0, 300))) return 'bot_challenge';
  if (status && status >= 400) return `http_error_${status}`;
  return null;
}

/**
 * The model is asked to pick a layout from the real photo count itself, but
 * it doesn't reliably obey "always X at the extremes" on every call (LLM
 * judgment calls vary run to run). We already know the real, code-counted
 * photo count here — enforce the boundaries deterministically and only let
 * the model's taste decide the ambiguous middle band.
 */
function pickLayout(photoCount, modelChoice) {
  if (photoCount <= 2) return 'list-ledger';
  if (photoCount >= 7) return 'magazine-split';
  return VALID_LAYOUTS.includes(modelChoice) ? modelChoice : 'grid-card';
}

async function capture(url) {
  const browser = await launchBrowser();
  try {
    // Mobile viewport: we judge (and rebuild) the mobile experience.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000); // let lazy content settle

    // Menu photos are frequently lazy-loaded (IntersectionObserver-triggered
    // <img loading="lazy">) and only get real dimensions once decoded, well
    // after scroll triggers the load — a bare naturalWidth read right after
    // scrolling is a race and undercounts real photos non-deterministically.
    // Scroll through, then explicitly wait for images to finish loading.
    await scrollAndWaitForImages(page);

    let pageMeta = await extractPageMeta(page);
    pageMeta.block_reason = detectBlockReason(resp?.status(), pageMeta.title, pageMeta.text);
    if (pageMeta.block_reason) return { screenshot: await page.screenshot({ fullPage: true }), pageMeta, photoFiles: [] };

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

async function scrollAndWaitForImages(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      [...document.images].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener('load', res, { once: true });
              img.addEventListener('error', res, { once: true });
              setTimeout(res, 4000);
            })
      )
    );
  });
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
    // Real content photos only: big enough to be food/interior shots, not
    // logos, icons, or tracking pixels. Kept deliberately low (120x90) since
    // menu-builder platforms (Square, Wix) commonly serve dish thumbnails at
    // ~150-160px wide — a 250px cutoff silently discards every real photo on
    // those sites while still passing their (larger) logo image.
    const fromImgTags = [...document.images]
      .filter((i) => i.naturalWidth >= 120 && i.naturalHeight >= 90 && i.src.startsWith('http'))
      .filter((i) => !/logo|icon|sprite|badge|payment/i.test(i.src + ' ' + (i.alt || '')))
      .map((i) => ({ src: i.src, alt: i.alt || '', w: i.naturalWidth, h: i.naturalHeight }));

    // Menu-builder platforms (Square, Wix, etc.) often lay out dish tiles as
    // CSS background-image divs rather than <img> tags, which the above
    // misses entirely — undercounting real photos and pushing the layout
    // choice (and hero/item photo matching) toward "no usable photos" when
    // there actually are some.
    const bgUrl = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/;
    const fromBackgrounds = [...document.querySelectorAll('*')]
      .filter((el) => el.clientWidth >= 120 && el.clientHeight >= 90)
      .map((el) => ({ el, m: bgUrl.exec(getComputedStyle(el).backgroundImage) }))
      .filter((x) => x.m && !/logo|icon|sprite|badge|payment/i.test(x.m[2] + ' ' + (x.el.getAttribute('aria-label') || '')))
      .map((x) => ({ src: x.m[2], alt: x.el.getAttribute('aria-label') || '', w: x.el.clientWidth, h: x.el.clientHeight }));

    // CDNs (Square, Wix, etc.) commonly serve the same dish photo at several
    // resized URLs (?width=160 vs ?width=800) — exact-string dedup would
    // count those as separate candidates, wasting slots in the 16-photo cap
    // and diluting the pool the model matches against. Normalize away known
    // size/quality params before deduping, keeping the larger variant.
    function normalizeSrc(src) {
      try {
        const u = new URL(src, location.href);
        ['width', 'height', 'w', 'h', 'size', 'quality', 'q', 'resize', 'fit', 'dpr'].forEach((k) => u.searchParams.delete(k));
        const qs = u.searchParams.toString();
        return u.origin + u.pathname + (qs ? '?' + qs : '');
      } catch {
        return src;
      }
    }
    const bestBySrc = new Map();
    for (const p of [...fromImgTags, ...fromBackgrounds]) {
      const key = normalizeSrc(p.src);
      const existing = bestBySrc.get(key);
      if (!existing || p.w * p.h > existing.w * existing.h) bestBySrc.set(key, p);
    }
    const photos = [...bestBySrc.values()].slice(0, 16).map((p, idx) => ({ index: idx, ...p }));

    // A menu that's just an embedded/linked PDF gives near-empty extractable
    // text — this signal lets low-content reporting say *why* rather than a
    // generic "low_confidence".
    const pdf_menu_signal = !!document.querySelector('embed[type="application/pdf"], iframe[src$=".pdf" i], object[data$=".pdf" i]')
      || [...document.querySelectorAll('a[href$=".pdf" i]')].some((a) => /menu/i.test(a.textContent + ' ' + a.href));

    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      fonts: [...styles].slice(0, 8),
      colors: [...colors].slice(0, 15),
      favicon: !!document.querySelector('link[rel*="icon"]'),
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000),
      photos,
      pdf_menu_signal,
    };
  });
}
