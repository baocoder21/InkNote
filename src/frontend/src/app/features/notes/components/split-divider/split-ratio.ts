/**
 * The share of the width that the editor takes in "Split" mode (the preview gets the rest): 0.5 = half and half.
 * Kept between a minimum and a maximum so that neither side can be dragged away by accident.
 */
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
export const SPLIT_DEFAULT = 0.5;

const STORAGE_KEY = 'inknote.splitRatio';

/** Puts a ratio inside the allowed range (anything that is not a number gives the default). */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return SPLIT_DEFAULT;
  }
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

/** The ratio the user chose last time, or the default. Storage can be blocked (private window): never an error. */
export function loadSplitRatio(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? SPLIT_DEFAULT : clampRatio(Number(saved));
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function saveSplitRatio(ratio: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampRatio(ratio)));
  } catch {
    /* not remembered, nothing else to do */
  }
}
