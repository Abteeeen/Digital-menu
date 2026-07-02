import fs from 'node:fs/promises';
import path from 'node:path';
import { config, slugify } from '../config.js';

/**
 * Stage 1 — Discovery.
 * Finds US restaurants with websites via Google Places Text Search (New),
 * or falls back to data/seed-restaurants.json when no key is configured.
 * Writes out/<slug>/lead.json for each prospect.
 */
export async function discover({ query = 'restaurants', city = 'Austin, TX', limit = 10 } = {}) {
  let leads;
  if (config.placesKey) {
    leads = await fromGooglePlaces(query, city, limit);
  } else {
    console.log('No GOOGLE_PLACES_API_KEY — using data/seed-restaurants.json');
    const raw = await fs.readFile(path.join(config.dataDir, 'seed-restaurants.json'), 'utf8');
    leads = JSON.parse(raw).slice(0, limit);
  }

  const saved = [];
  for (const lead of leads) {
    if (!lead.website) continue;
    lead.slug = slugify(lead.name);
    const dir = path.join(config.outDir, lead.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'lead.json'), JSON.stringify(lead, null, 2));
    saved.push(lead);
    console.log(`  + ${lead.name} — ${lead.website}`);
  }
  console.log(`Discovery: ${saved.length} leads with websites saved to out/`);
  return saved;
}

async function fromGooglePlaces(query, city, limit) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.placesKey,
      'X-Goog-FieldMask':
        'places.displayName,places.websiteUri,places.formattedAddress,places.addressComponents,places.primaryTypeDisplayName',
    },
    body: JSON.stringify({ textQuery: `${query} in ${city}`, maxResultCount: Math.min(limit, 20) }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const { places = [] } = await res.json();

  return places
    .filter((p) => p.websiteUri)
    .map((p) => {
      const comp = (type) =>
        p.addressComponents?.find((c) => c.types?.includes(type))?.shortText || '';
      return {
        name: p.displayName?.text || 'Unknown',
        website: p.websiteUri,
        cuisine: p.primaryTypeDisplayName?.text || 'Restaurant',
        address: {
          full: p.formattedAddress || '',
          line1: [comp('street_number'), comp('route')].filter(Boolean).join(' '),
          city: comp('locality'),
          state: comp('administrative_area_level_1'),
          zip: comp('postal_code'),
        },
      };
    });
}
