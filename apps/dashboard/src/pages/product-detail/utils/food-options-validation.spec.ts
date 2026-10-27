import { expect, it } from "vitest";
import { foodOptionsError, maximumFoodOptionPrice } from "./food-options-validation.js";
import { validateProductMetadata } from "./product-validation.js";
const group = { id: "extras", name: "Extras", required: true, selectionType: "multiple" as const, minSelections: 1, maxSelections: 2,
  items: [{ id: "a", name: "A", priceModifierInCents: 500 }, { id: "b", name: "B", priceModifierInCents: 1000 }, { id: "c", name: "C", priceModifierInCents: 300 }] };
it("previews only the most expensive permitted choices, including single groups", () => {
  expect(maximumFoodOptionPrice([group])).toBe(1500);
  expect(maximumFoodOptionPrice([{ ...group, selectionType: "single", maxSelections: 1 }])).toBe(1000);
  expect(maximumFoodOptionPrice([{ ...group, maxSelections: undefined }])).toBe(1800);
});
it("rejects bounds that exceed item count, fractional limits and contradictory required choices", () => {
  for (const change of [{ minSelections: 0 }, { minSelections: 3 }, { maxSelections: 4 }, { maxSelections: 1.5 }]) {
    expect(foodOptionsError([{ ...group, ...change }])).toBeTruthy();
    expect(validateProductMetadata("food", { optionGroups: [{ ...group, ...change }] }).optionGroups).toBeTruthy();
  }
});
it("refuses missing names, duplicate IDs and invalid prices instead of displaying a zero maximum", () => {
  for (const groups of [[{ ...group, name: "" }], [{ ...group, items: [group.items[0], group.items[0]] }],
    [{ ...group, items: [{ ...group.items[0], priceModifierInCents: NaN }] }]]) {
    expect(foodOptionsError(groups)).toBeTruthy(); expect(maximumFoodOptionPrice(groups)).toBeNull();
  }
  expect(foodOptionsError([])).toBeUndefined();
});
