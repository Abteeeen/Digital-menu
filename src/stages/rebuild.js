import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const exec = promisify(execFile);

/**
 * Stage 3 — Rebuild.
 * Injects the extracted menu + brand into the mobile menu-app template,
 * writes a self-contained static app to out/<slug>/app/, and deploys it to
 * Vercel when VERCEL_TOKEN is set. Returns the live URL.
 * Writes out/<slug>/rebuild.json.
 */
export async function rebuild(lead, analysis) {
  const dir = path.join(config.outDir, lead.slug);
  const appDir = path.join(dir, 'app');
  await fs.mkdir(appDir, { recursive: true });

  const template = await fs.readFile(path.join(config.templatesDir, 'menu-app.html'), 'utf8');
  const payload = {
    brand: analysis.brand,
    menu: analysis.menu,
    generated_at: new Date().toISOString(),
  };
  const html = template.replace('/*__MENU_DATA__*/null', JSON.stringify(payload));
  await fs.writeFile(path.join(appDir, 'index.html'), html);

  let url = `${config.publicBaseUrl}/${lead.slug}`;
  let deployed = false;
  if (config.vercelToken) {
    url = await deployToVercel(appDir, lead.slug);
    deployed = true;
    console.log(`  deployed: ${url}`);
  } else {
    console.log(`  built static app at out/${lead.slug}/app (no VERCEL_TOKEN; QR will use ${url})`);
  }

  const result = { url, deployed, app_dir: appDir };
  await fs.writeFile(path.join(dir, 'rebuild.json'), JSON.stringify(result, null, 2));
  return result;
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
