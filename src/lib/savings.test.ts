import { describe, expect, it } from "vitest";
import { estimateSaving } from "./savings";

describe("estimateSaving", () => {
  it("is the gap between pump and lock, times litres", () => {
    const s = estimateSaving(234.9, 225.9, 50);
    expect(s.perLitre).toBe(9);
    expect(s.total).toBeCloseTo(4.5);
    expect(s.capped).toBe(false);
  });

  it("caps the discount at 25 cents a litre", () => {
    const s = estimateSaving(260, 220, 100);
    expect(s.perLitre).toBe(25);
    expect(s.total).toBe(25);
    expect(s.capped).toBe(true);
  });

  it("never charges more than the pump when the lock is dearer", () => {
    expect(estimateSaving(200, 210, 50)).toEqual({ perLitre: 0, total: 0, capped: false });
  });

  it("limits a fill to the 150 L the lock covers", () => {
    expect(estimateSaving(240, 230, 400).total).toBeCloseTo(15);
  });
});
