import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Candidate destination: apps/widget_v2/tests/service-booking-css-package.spec.ts
// Source/package wiring only. This does not replace the real Next/browser gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const consumer = createRequire(resolve(root, "apps/storefront/package.json"));

test("T47 service picker stylesheet reaches the storefront package consumer", async t => {
  await t.test("the public stylesheet subpath resolves to the real component stylesheet", () => {
    const stylesheet = consumer.resolve("@zyon/widget-v2/styles/service-booking.css");
    assert.equal(realpathSync(stylesheet), realpathSync(resolve(root,
      "apps/widget_v2/src/components/checkout/ServiceBookingPicker.css")));
    assert.equal(statSync(stylesheet).isFile(), true);
  });
  await t.test("the actual storefront root explicitly loads the exported stylesheet", () => {
    const layout = readFileSync(resolve(root, "apps/storefront/src/app/layout.tsx"), "utf8");
    const imports = layout.match(/\bimport\s+["']@zyon\/widget-v2\/styles\/service-booking\.css["']\s*;/g);
    assert.equal(imports?.length, 1, "the packaged picker CSS must be loaded exactly once");
  });
});
