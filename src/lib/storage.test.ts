import { beforeEach, describe, expect, it } from "vitest";
import { clearSaved, loadSaved, saveSaved } from "./storage";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
});

describe("saved preferences", () => {
  it("round-trips and merges patches", () => {
    saveSaved({ center: { lat: -33.9, lng: 151.1, label: "Hurstville", source: "search" }, radius: 12 });
    saveSaved({ homeId: "fc-277", litres: 60 });
    expect(loadSaved()).toEqual({
      center: { lat: -33.9, lng: 151.1, label: "Hurstville", source: "search" },
      radius: 12,
      homeId: "fc-277",
      litres: 60,
    });
  });

  it("removes the home station when set to null", () => {
    saveSaved({ homeId: "fc-1" });
    saveSaved({ homeId: null });
    expect(loadSaved().homeId).toBeUndefined();
  });

  it("drops invalid values instead of trusting them", () => {
    storage.setItem(
      "lockspot:v1",
      JSON.stringify({ center: { lat: 999, lng: 1, label: "x", source: "gps" }, radius: 5000, litres: 9000, limit: "yes" }),
    );
    expect(loadSaved()).toEqual({ litres: 150 });
  });

  it("survives corrupt JSON and blocked storage", () => {
    storage.setItem("lockspot:v1", "{nope");
    expect(loadSaved()).toEqual({});
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(loadSaved()).toEqual({});
    expect(saveSaved({ radius: 5 })).toBe(false);
    expect(() => clearSaved()).not.toThrow();
  });

  it("clears everything", () => {
    saveSaved({ radius: 5 });
    clearSaved();
    expect(loadSaved()).toEqual({});
  });
});
