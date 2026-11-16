import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckoutSession } from "@zyon/shared-types";
import { paymentCartFingerprint } from "./payment-cart-fingerprint.js";

// Captured from unmodified 9bbe3b750 before the new service fingerprint.
const fixtures: Array<{ name: string; hash: string; fixture: Pick<CheckoutSession, "cart" | "shipping"> }> = [
  {
    "name": "physical",
    "hash": "3eb17524a8941ab2f52cba0930b5e69507c3961605dc24b64123a297dab6ea7c",
    "fixture": {
      "cart": {
        "currency": "BRL",
        "total": 149.8,
        "currentDiscount": 10,
        "items": [
          {
            "sku": "physical-one",
            "product_id": "p1",
            "variant": "[\"v1\",[]]",
            "variantId": "v1",
            "productType": "physical",
            "fulfillmentStrategy": "carrier",
            "price": 74.9,
            "quantity": 2
          }
        ]
      },
      "shipping": {
        "carrierKey": "correios-pac",
        "customerPrice": 12.5
      }
    }
  },
  {
    "name": "digital",
    "hash": "03710c4333a1c7dd8593834b39a92d371aeae725edde6b5ce8cf1e1299eed7b7",
    "fixture": {
      "cart": {
        "currency": "USD",
        "total": 29.99,
        "items": [
          {
            "sku": "digital-one",
            "product_id": "d1",
            "variantId": "dv1",
            "productType": "digital",
            "fulfillmentStrategy": "digital",
            "price": 29.99,
            "quantity": 1
          }
        ]
      },
      "shipping": {
        "customerPrice": 999
      }
    }
  },
  {
    "name": "food",
    "hash": "6416d43a242e1422a8ad1357aeb47cb8c893a12cba4e36d797466f5bc3e3b24b",
    "fixture": {
      "cart": {
        "currency": "BRL",
        "total": 35,
        "items": [
          {
            "sku": "food-one",
            "product_id": "f1",
            "variantId": "fv1",
            "productType": "food",
            "fulfillmentStrategy": "pickup",
            "price": 17.5,
            "quantity": 2
          }
        ]
      },
      "shipping": {
        "customerPrice": 7
      }
    }
  },
  {
    "name": "legacy",
    "hash": "b108981ceb5e596986a9126745765ecebd3193f59b0670dd32c3b82f464a382b",
    "fixture": {
      "cart": {
        "currency": "BRL",
        "total": 50,
        "items": [
          {
            "sku": "legacy-service",
            "product_id": "s1",
            "variantId": "sv1",
            "productType": "service",
            "fulfillmentStrategy": "scheduled_service",
            "price": 50,
            "quantity": 1,
            "fulfillmentSchedule": {
              "slotId": "legacy-slot",
              "startsAt": "2030-01-01T10:00:00.000Z",
              "endsAt": "2030-01-01T10:30:00.000Z",
              "timeZone": "UTC",
              "durationMinutes": 30
            }
          }
        ]
      }
    }
  }
];

test("T28 fingerprint", async t => {
  for (const saved of fixtures) await t.test(saved.name + " fingerprint remains byte-compatible", () => {
    const before = structuredClone(saved.fixture);
    assert.equal(paymentCartFingerprint(saved.fixture), saved.hash);
    assert.deepEqual(saved.fixture, before);
  });
  await t.test("new selection binds professional, policy, calendar and date; presentation stays excluded", () => {
    const saved = structuredClone(fixtures.find(value => value.name === "legacy")!.fixture);
    const schedule = saved.cart.items[0].fulfillmentSchedule!;
    Object.assign(schedule, { professionalId: "professional-a", professionalVersion: 4, policyVersion: 6, date: "2030-01-01" });
    const baseline = paymentCartFingerprint(saved);
    assert.notEqual(baseline, fixtures.find(value => value.name === "legacy")!.hash);
    for (const [key, value] of [["professionalId", "professional-b"], ["professionalVersion", 5], ["policyVersion", 7], ["date", "2030-01-02"]] as const) {
      const changed = structuredClone(saved); Reflect.set(changed.cart.items[0].fulfillmentSchedule!, key, value);
      assert.notEqual(paymentCartFingerprint(changed), baseline);
    }
    saved.cart.items[0].name = "Presentation changed";
    saved.cart.items[0].imageUrl = "https://example.test/placeholder.jpg";
    assert.equal(paymentCartFingerprint(saved), baseline);
  });
});
