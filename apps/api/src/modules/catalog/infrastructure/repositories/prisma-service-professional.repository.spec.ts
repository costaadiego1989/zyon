import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedVersion, validateProfessionalInput } from "../../domain/services/service-professional-input.js";

test("T18", async t => {
  const valid = { publicName: " Synthetic operator ", publicProfile: { description: "Public description", specialties: ["Consulting"] }, timeZone: "America/Sao_Paulo", productIds: ["canonical-product"] };
  await t.test("professional profile has public fields and no login dependency", () => {
    assert.deepEqual(validateProfessionalInput(valid), { ...valid, publicName: "Synthetic operator" });
    for (const extra of [{ userId: "login" }, { email: "private@example.test" }, { publicProfile: { privateNotes: "private" } }]) assert.throws(() => validateProfessionalInput({ ...valid, ...extra }), /invalid_professional/);
  });
  await t.test("name, profile, timezone and associations are bounded", () => {
    for (const invalid of [{ publicName: " " }, { publicName: "a".repeat(121) }, { timeZone: "Missing/Zone" }, { publicProfile: { description: "a".repeat(1201) } }, { publicProfile: { specialties: [""] } }, { productIds: ["a", "a"] }, { productIds: Array.from({ length: 101 }, (_, i) => String(i)) }, { isActive: "true" }]) assert.throws(() => validateProfessionalInput({ ...valid, ...invalid }), /professional|timezone/);
  });
  await t.test("edits require a positive expected version", () => {
    for (const invalid of [undefined, null, 0, -1, 1.5, "1", 2_147_483_647]) assert.throws(() => assertExpectedVersion(invalid), /expected_version_required/);
    assert.equal(assertExpectedVersion(1), undefined);
  });
});
