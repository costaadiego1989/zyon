import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FoodOptionValidationError,
  extractOptionGroups,
  resolveSelectedOptions,
} from "./food-options.js";

const groups = extractOptionGroups({
  optionGroups: [
    {
      id: "size",
      name: "Tamanho",
      required: true,
      selectionType: "single",
      items: [
        { id: "medium", name: "Média", priceModifierInCents: 0 },
        { id: "large", name: "Grande", priceModifierInCents: 700 },
      ],
    },
    {
      id: "extras",
      name: "Adicionais",
      required: false,
      selectionType: "multiple",
      items: [
        { id: "bacon", name: "Bacon", priceModifierInCents: 450 },
        { id: "cheese", name: "Queijo extra", priceModifierInCents: 300 },
      ],
    },
  ],
});

describe("food options", () => {
  it("prices only catalog-backed selections for a food order", () => {
    const resolved = resolveSelectedOptions(groups, ["large", "bacon", "cheese"]);

    assert.equal(resolved.priceModifierInCents, 1_450);
    assert.deepEqual(resolved.selected.map((option) => option.itemId), ["large", "bacon", "cheese"]);
  });

  it("rejects checkout when a required food choice is missing", () => {
    assert.throws(
      () => resolveSelectedOptions(groups, ["bacon"]),
      (error: unknown) => error instanceof FoodOptionValidationError && error.code === "required_group_missing",
    );
  });

  it("rejects multiple choices for a single-select group and unknown option ids", () => {
    assert.throws(
      () => resolveSelectedOptions(groups, ["medium", "large"]),
      (error: unknown) => error instanceof FoodOptionValidationError && error.code === "single_group_multiple_selected",
    );
    assert.throws(
      () => resolveSelectedOptions(groups, ["medium", "client-supplied-price"]),
      (error: unknown) => error instanceof FoodOptionValidationError && error.code === "unknown_option_item",
    );
  });
});
