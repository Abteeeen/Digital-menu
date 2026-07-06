import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const exec = promisify(execFile);

const LAYOUTS = ['grid-card', 'list-ledger', 'magazine-split'];
const DEFAULT_LAYOUT = 'grid-card';

/**
 * Stage 3 — Rebuild.
 * Injects the extracted menu + brand into the layout template analyzeSite()
 * picked (templates/layouts/<layout>.html), writes a self-contained static
 * app to out/<slug>/app/, and deploys it to Vercel when VERCEL_TOKEN is set.
 * Returns the live URL. Writes out/<slug>/rebuild.json.
 */
export async function rebuild(lead, analysis) {
  const dir = path.join(config.outDir, lead.slug);
  const appDir = path.join(dir, 'app');
  await fs.mkdir(appDir, { recursive: true });

  const layout = LAYOUTS.includes(analysis.layout) ? analysis.layout : DEFAULT_LAYOUT;
  const template = await fs.readFile(path.join(config.templatesDir, 'layouts', `${layout}.html`), 'utf8');
  const images = await loadAssets(path.join(dir, 'assets'));
  const menu = attachImages(analysis.menu, images);
  const payload = {
    brand: analysis.brand,
    hero_image: images[analysis.hero_image] ?? null,
    menu,
    generated_at: new Date().toISOString(),
  };
  const html = template.replace('/*__MENU_DATA__*/null', JSON.stringify(payload));
  await fs.writeFile(path.join(appDir, 'index.html'), html);

  let url = `${config.publicBaseUrl}/${lead.slug}`;
  let deployed = false;
  if (config.vercelToken) {
    url = await deployToVercel(appDir, lead.slug);
    deployed = true;
    console.log(`  deployed (${layout}): ${url}`);
  } else {
    console.log(`  built static app at out/${lead.slug}/app (${layout} layout; no VERCEL_TOKEN; QR will use ${url})`);
  }

  const result = { url, deployed, app_dir: appDir, layout };
  await fs.writeFile(path.join(dir, 'rebuild.json'), JSON.stringify(result, null, 2));
  return result;
}

/** Read out/<slug>/assets/img-N.* into { N: dataURI }. */
async function loadAssets(assetsDir) {
  const images = {};
  let files = [];
  try {
    files = await fs.readdir(assetsDir);
  } catch {
    return images;
  }
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
  for (const f of files) {
    const m = f.match(/^img-(\d+)\.(\w+)$/);
    if (!m) continue;
    const buf = await fs.readFile(path.join(assetsDir, f));
    images[Number(m[1])] = `data:${mime[m[2]] || 'image/jpeg'};base64,${buf.toString('base64')}`;
  }
  return images;
}

/** Replace item.image photo indices with embedded data URIs. */
function attachImages(menu, images) {
  return {
    ...menu,
    categories: (menu.categories || []).map((c) => ({
      ...c,
      items: c.items.map((it) => ({
        ...it,
        image: it.image != null && images[it.image] ? images[it.image] : null,
      })),
    })),
  };
}

async function deployToVercel(appDir, slug) {
  const args = [
    '--yes', 'vercel@latest', 'deploy', appDir,
    '--prod', '--yes',
    '--token', config.vercelToken,
    '--name', `menu-${slug}`,
  ];
  const { stdout } = await exec('npx', args, { timeout: 180000 });
  const url = stdout.trim().split('\n').pop();
  if (!/^https:\/\//.test(url)) throw new Error(`Unexpected vercel output: ${stdout}`);
  return url;
}
