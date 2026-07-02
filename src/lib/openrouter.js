import { config } from '../config.js';

const API = 'https://openrouter.ai/api/v1/chat/completions';

async function chat(model, messages, { json = false } = {}) {
  if (!config.openRouterKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to .env or run with --demo.');
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouterKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'plate-pixel',
    },
    body: JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/** Extract the first JSON object from a model reply (tolerates code fences). */
function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Model did not return JSON:\n${text.slice(0, 500)}`);
  return JSON.parse(m[0]);
}

/**
 * Vision pass over a full-page screenshot + page metadata.
 * Returns { ugliness_score, verdict, quirk, brand, menu } — see prompt for shape.
 */
export async function analyzeSite({ screenshotBase64, pageMeta }) {
  const prompt = `You are a brutal restaurant-website design critic and data extractor.
You are given a full-page screenshot of a restaurant's website/menu page plus extracted page metadata (title tag, fonts, colors, raw text).

Return ONLY a JSON object with this exact shape:
{
  "ugliness_score": <1-10, 10 = unusable eyesore. Judge: readability, mobile-friendliness, dated design, PDF-only menus, clutter>,
  "verdict": "<one savage but professional sentence on the design>",
  "quirk": "<ONE hyper-specific, verifiable mistake or oddity, phrased to the owner in second person, e.g. 'Your website tab title says Vid Nikolic instead of Kiyomi' or 'Your menu is a sideways photo of a paper menu'. Must reference something actually visible in the screenshot or metadata.>",
  "brand": {
    "name": "<restaurant name>",
    "tagline": "<their tagline or invent a fitting one, max 8 words>",
    "primary_color": "<hex — dominant brand color from the site>",
    "accent_color": "<hex — secondary/accent color>",
    "bg_color": "<hex — a tasteful dark or light background that suits the cuisine>",
    "font_style": "<'serif' | 'sans' | 'display'>",
    "cuisine": "<cuisine type>"
  },
  "menu": {
    "categories": [
      { "name": "<category>", "items": [ { "name": "", "description": "", "price": "<as shown, keep currency>" } ] }
    ]
  }
}
Extract EVERY menu item you can read with its real price. If descriptions are missing, write a short appetizing one and prefix nothing (keep it natural).

Page metadata:
${JSON.stringify(pageMeta).slice(0, 6000)}`;

  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
  ];
  const reply = await chat(config.visionModel, [{ role: 'user', content }], { json: true });
  return parseJson(reply);
}

/** Punchy postcard copy quoting the quirk. Returns { headline, body }. */
export async function writePostcard({ restaurant, quirk, fromName }) {
  const prompt = `Write postcard copy for a cold B2B pitch to a restaurant owner. We secretly rebuilt their ugly online menu into a beautiful mobile web app and are mailing them a QR code to it.

Rules:
- Headline: max 6 words, first person, confident. e.g. "I rebuilt your menu."
- Body: max 55 words. MUST quote their specific quirk verbatim-ish to prove we actually looked: "${quirk}". Then say we fixed it, the new menu is live, scan the QR — it's all theirs, free. No hard sell, no corporate speak. Sign-off is handled separately.
- Tone: sharp, warm, a little cheeky. Like a talented freelancer, not a SaaS drip campaign.

Restaurant: ${restaurant}. Sender first name: ${fromName}.
Return ONLY JSON: { "headline": "...", "body": "..." }`;
  const reply = await chat(config.textModel, [{ role: 'user', content: prompt }], { json: true });
  return parseJson(reply);
}
