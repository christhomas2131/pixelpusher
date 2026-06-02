// Single source of truth for free vs pro gating.
//
// Pricing model: PixelPusher is a one-time purchase. There is no subscription,
// no annual renewal, no "free updates for X years" clause. A purchased license
// is good for the lifetime of the product.

export type Tier = 'free' | 'pro';

// Free tier ceilings.
export const FREE_FILE_CAP = 5000;
export const FREE_DUPE_GROUPS_CAP = 25;

// Where the renderer's "Upgrade" CTA points. Currently the marketing-site
// pricing anchor; swap to a Stripe/Paddle/FastSpring checkout URL once the
// real billing flow is wired. Read by both main and renderer.
export const PURCHASE_URL = 'https://pixelpusher.app/#pricing';

// Pricing copy that appears next to the CTA. Single source of truth so
// updating from $12 → $19 (or whatever) doesn't require grepping the UI.
export const PRICE_LABEL = '$12';
export const PRICING_TAGLINE = 'one-time purchase · all future updates included';

// Features gated behind Pro. Exhaustive list — consult this before adding new
// surface area. Avoid scattering `if (isPro())` checks across the codebase;
// route them through `requiresPro` instead.
export const PRO_FEATURES = [
  'unlimited_organize',     // organize > FREE_FILE_CAP files
  'unlimited_dupe_review',  // see > FREE_DUPE_GROUPS_CAP dupe groups
  'ai_search',              // CLIP / sentence-transformers (M6)
  'auto_cluster',           // HDBSCAN doc auto-grouping (M7)
  'datahoarder_mode',       // documents / audio / design / 3D mode (M2-M3)
  'photos_library_import',  // Mac-only Apple Photos library reader (M5)
  'watch_folders',          // background daemon (M8)
  'smart_albums',           // saved-query views (M8)
  'xmp_sidecars',           // Lightroom/Capture One compat (M8)
  'bulk_metadata_fixer',    // (M8)
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

export function requiresPro(feature: ProFeature, tier: Tier): boolean {
  // Defense against typos in callers — passing an unknown feature would
  // silently return `tier === 'free'` and gate things accidentally.
  if (!(PRO_FEATURES as readonly string[]).includes(feature)) {
    throw new Error(`Unknown Pro feature: ${feature}. Add to PRO_FEATURES in pro-features.ts.`);
  }
  return tier === 'free';
}

// Error code thrown by main → caught by renderer → triggers upgrade modal.
// Format: "PRO_REQUIRED:<feature>:<human message>"
export const PRO_REQUIRED_PREFIX = 'PRO_REQUIRED';

export function proRequiredError(feature: ProFeature, message: string): Error {
  return new Error(`${PRO_REQUIRED_PREFIX}:${feature}:${message}`);
}

export function parseProRequiredError(message: string): { feature: ProFeature; reason: string } | null {
  // The message may be wrapped by Electron's IPC error transport, e.g.
  //   "Error invoking remote method 'organize:start': Error: PRO_REQUIRED:unlimited_organize:Free tier..."
  // so we locate the prefix anywhere in the string.
  const idx = message.indexOf(PRO_REQUIRED_PREFIX + ':');
  if (idx === -1) return null;
  const tail = message.slice(idx + PRO_REQUIRED_PREFIX.length + 1);
  const sep = tail.indexOf(':');
  if (sep === -1) return null;
  const feature = tail.slice(0, sep) as ProFeature;
  if (!(PRO_FEATURES as readonly string[]).includes(feature)) return null;
  return { feature, reason: tail.slice(sep + 1).trim() };
}
