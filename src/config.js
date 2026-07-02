import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  outDir: path.join(root, 'out'),
  dataDir: path.join(root, 'data'),
  templatesDir: path.join(root, 'templates'),

  openRouterKey: process.env.OPENROUTER_API_KEY || '',
  visionModel: process.env.OPENROUTER_VISION_MODEL || 'anthropic/claude-sonnet-4.5',
  textModel: process.env.OPENROUTER_TEXT_MODEL || 'anthropic/claude-sonnet-4.5',

  placesKey: process.env.GOOGLE_PLACES_API_KEY || '',
  vercelToken: process.env.VERCEL_TOKEN || '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://menus.example.com').replace(/\/$/, ''),
  lobKey: process.env.LOB_API_KEY || '',

  uglinessThreshold: Number(process.env.UGLINESS_THRESHOLD || 6),

  from: {
    name: process.env.FROM_NAME || 'Chris',
    company: process.env.FROM_COMPANY || 'Plate & Pixel',
    address_line1: process.env.FROM_ADDRESS_LINE1 || '123 Main St',
    address_city: process.env.FROM_CITY || 'Austin',
    address_state: process.env.FROM_STATE || 'TX',
    address_zip: process.env.FROM_ZIP || '78701',
  },
};

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
