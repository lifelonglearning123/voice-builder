// Single source of truth for wizard step numbering. The order of this array
// IS the display order. Each page imports wizardStep(slug) instead of
// hardcoding step/total, so adding or removing a step only needs one edit.

export const WIZARD_SLUGS = [
  'intro',
  'basics',
  'voice',
  'review',
  'phone',
  'after-call',
  'ready',
] as const;

export type WizardSlug = (typeof WIZARD_SLUGS)[number];
export const WIZARD_TOTAL = WIZARD_SLUGS.length;

export function wizardStep(slug: WizardSlug): { step: number; total: number } {
  const idx = WIZARD_SLUGS.indexOf(slug);
  if (idx < 0) throw new Error(`Unknown wizard slug: ${slug}`);
  return { step: idx + 1, total: WIZARD_TOTAL };
}
