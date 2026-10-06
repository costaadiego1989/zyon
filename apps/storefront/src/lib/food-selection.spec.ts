import assert from "node:assert/strict";
import test from "node:test";
import { foodSelectionError, foodSelectionLabel, toggleFoodSelection } from "./food-selection.js";
const group = { name: "Adicionais", required: true, selectionType: "multiple" as const, minSelections: 2, maxSelections: 2,
  items: [{ id: "cheese" }, { id: "bacon" }, { id: "onion" }] };
test("two required options reject incomplete selection and keep existing choices at the maximum", () => {
  let selected = toggleFoodSelection(new Set(), group, "cheese");
  assert.match(foodSelectionError(group, selected)!, /pelo menos 2/);
  selected = toggleFoodSelection(selected, group, "bacon"); assert.equal(foodSelectionError(group, selected), null);
  selected = toggleFoodSelection(selected, group, "onion"); assert.deepEqual([...selected], ["cheese", "bacon"]);
  selected = toggleFoodSelection(selected, group, "bacon"); selected = toggleFoodSelection(selected, group, "onion");
  assert.deepEqual([...selected], ["cheese", "onion"]); assert.equal(foodSelectionLabel(group), "Escolha 2");
});
test("optional single choice can be removed while required single choice remains selected", () => {
  const optional = { ...group, selectionType: "single" as const, required: false, minSelections: 0, maxSelections: 1 };
  let selected = toggleFoodSelection(new Set(), optional, "cheese"); selected = toggleFoodSelection(selected, optional, "cheese");
  assert.equal(selected.size, 0);
  const required = { ...optional, required: true, minSelections: 1 };
  selected = toggleFoodSelection(new Set(), required, "cheese"); selected = toggleFoodSelection(selected, required, "cheese");
  assert.deepEqual([...selected], ["cheese"]); selected = toggleFoodSelection(selected, required, "bacon"); assert.deepEqual([...selected], ["bacon"]);
});
test("legacy multiple defaults, unknown IDs and independent groups retain their behavior", () => {
  const legacy = { name: "Extras", required: false, selectionType: "multiple" as const, items: group.items };
  let selected = new Set(["size-large"]);
  for (const item of group.items) selected = toggleFoodSelection(selected, legacy, item.id);
  assert.deepEqual([...selected], ["size-large", "cheese", "bacon", "onion"]);
  assert.equal(toggleFoodSelection(selected, legacy, "unknown"), selected);
  assert.equal(foodSelectionError(legacy, selected), null); assert.equal(foodSelectionLabel(legacy), "Escolha até 3");
});
