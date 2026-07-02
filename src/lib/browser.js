import fs from 'node:fs';
import { chromium } from 'playwright';

/**
 * Launch Chromium, tolerating environments where the Playwright-managed
 * download is missing but a system/preinstalled binary exists
 * (CHROMIUM_PATH, then common preinstall locations).
 */
export async function launchBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    ...globCandidates(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  try {
    return await chromium.launch();
  } catch (err) {
    for (const p of candidates) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return chromium.launch({ executablePath: p });
      }
    }
    throw err;
  }
}

function globCandidates() {
  try {
    return fs
      .readdirSync('/opt/pw-browsers')
      .filter((d) => d.startsWith('chromium-'))
      .map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`);
  } catch {
    return [];
  }
}
