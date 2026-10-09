/** Terms: the lock takes at most 25¢/L off the pump price, covers up to 150 L, and never raises a price. */
export const DISCOUNT_CAP_CENTS = 25;
export const MAX_LITRES = 150;
export const DEFAULT_LITRES = 50;

export interface Saving {
  /** Cents off per litre. */
  perLitre: number;
  /** Dollars off the whole fill. */
  total: number;
  /** The gap between pump and lock was bigger than the 25¢/L cap. */
  capped: boolean;
}

export const clampLitres = (n: number) => Math.min(MAX_LITRES, Math.max(1, Math.round(n)));

/** What a lock at `lock` ¢/L saves when redeemed at a pump charging `pump` ¢/L. */
export function estimateSaving(pump: number, lock: number, litres: number): Saving {
  const gap = pump - lock;
  const perLitre = Math.round(Math.min(DISCOUNT_CAP_CENTS, Math.max(0, gap)) * 10) / 10;
  return { perLitre, total: (perLitre * clampLitres(litres)) / 100, capped: gap > DISCOUNT_CAP_CENTS };
}
