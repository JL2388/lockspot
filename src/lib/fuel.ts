export const FUELS = [
  { code: "U91", label: "Unleaded 91" },
  { code: "E10", label: "E10" },
  { code: "P95", label: "Premium 95" },
  { code: "P98", label: "Premium 98" },
  { code: "DL", label: "Diesel" },
  { code: "PDL", label: "Premium diesel" },
  { code: "LPG", label: "LPG" },
] as const;

export type FuelCode = (typeof FUELS)[number]["code"];

export const DEFAULT_FUEL: FuelCode = "U91";

export const isFuelCode = (s: string | null | undefined): s is FuelCode =>
  FUELS.some((f) => f.code === s);

export const fuelLabel = (code: FuelCode) => FUELS.find((f) => f.code === code)!.label;
