// Renders the bundled "ugly site" fixture to data/demo/before.png.
// Run once: node scripts/make-demo-before.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/lib/browser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data', 'demo', 'ugly-site.html');
const out = path.join(root, 'data', 'demo', 'before.png');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('file://' + src);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote', out);
