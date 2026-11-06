// The demo stores: every story in the demo needs one store of each kind, and a page an agent can read.
import { describe, expect, it } from "vitest";
import { findProduct, findStore, findStoreByName, productPageText, STORES } from "../catalog";
import { CATEGORIES } from "../types";

describe("demo stores", () => {
  it("every product id is unique and every price is positive", () => {
    const ids = STORES.flatMap((s) => s.products.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STORES) for (const p of s.products) expect(p.price).toBeGreaterThan(0);
  });
  it("every product sits in one of the categories the rules know", () => {
    for (const s of STORES) for (const p of s.products) expect(CATEGORIES).toContain(p.category);
  });
  it("has a reliable store, one that ships damaged goods, and one that never ships", () => {
    const kinds = new Set(STORES.map((s) => s.fulfillment));
    expect([...kinds].sort()).toEqual(["never_ships", "reliable", "ships_damaged"]);
  });
  it("at least one product page hides a note aimed at AI agents", () => {
    const notes = STORES.flatMap((s) => s.products.map((p) => p.sellerNote ?? "")).filter(Boolean);
    expect(notes.some((n) => /AI/.test(n))).toBe(true);
  });
});

describe("finding things", () => {
  it("finds a product together with its store", () => {
    const found = findProduct("sh-speaker");
    expect(found?.product.name).toBe("Portable Bluetooth speaker");
    expect(found?.store.name).toBe("SoundHouse");
    expect(findProduct("no-such-thing")).toBeUndefined();
  });
  it("finds a store by slug, or by name whatever the case and spacing", () => {
    expect(findStore("soundhouse")?.name).toBe("SoundHouse");
    expect(findStoreByName("  soundhouse ")?.slug).toBe("soundhouse");
    expect(findStoreByName("Unknown Store")).toBeUndefined();
  });
  it("a product page shows the seller's note only when there is one", () => {
    const plain = findProduct("sh-speaker")!.product;
    expect(productPageText(plain)).toBe("Portable Bluetooth speaker. $59. Waterproof, 12-hour battery.");
    const tricky = STORES.flatMap((s) => s.products).find((p) => p.sellerNote)!;
    expect(productPageText(tricky)).toContain(`Seller note: ${tricky.sellerNote}`);
  });
});
