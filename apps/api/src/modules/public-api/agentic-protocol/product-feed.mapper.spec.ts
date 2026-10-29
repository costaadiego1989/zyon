import test from "node:test";
import assert from "node:assert/strict";
import { ProductFeedMapper, minorUnitsToDecimalPrice } from "./product-feed.mapper.js";

test("minorUnitsToDecimalPrice converts minor units to decimal string", () => {
  assert.equal(minorUnitsToDecimalPrice(0), "0.00");
  assert.equal(minorUnitsToDecimalPrice(100), "1.00");
  assert.equal(minorUnitsToDecimalPrice(19990), "199.90");
  assert.equal(minorUnitsToDecimalPrice(1), "0.01");
  assert.equal(minorUnitsToDecimalPrice(9999), "99.99");
});

test("minorUnitsToDecimalPrice rejects negative amounts", () => {
  assert.throws(() => minorUnitsToDecimalPrice(-100), /Negative price/);
});

test("minorUnitsToDecimalPrice rejects non-finite values", () => {
  assert.throws(() => minorUnitsToDecimalPrice(NaN), /Invalid price/);
  assert.throws(() => minorUnitsToDecimalPrice(Infinity), /Invalid price/);
});

test("toFeedRow maps product to canonical row", () => {
  const input = {
    product: {
      id: "prod_123",
      name: "Tênis XYZ",
      description: "Premium sneaker",
      slug: "tenis-xyz",
      variants: [
        {
          basePriceInCents: 19990,
          currency: "BRL",
          media: [
            { url: "https://example.com/shoe.jpg", type: "IMAGE" as const, order: 0 },
          ],
          stockQuantity: 5,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
    brandName: "MyBrand",
    publicBaseUrl: "https://store.example.com",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.id, "prod_123");
  assert.equal(row.title, "Tênis XYZ");
  assert.equal(row.description, "Premium sneaker");
  assert.equal(row.link, "https://store.example.com/tenis-xyz");
  assert.equal(row.image_link, "https://example.com/shoe.jpg");
  assert.equal(row.availability, "in_stock");
  assert.equal(row.price, "199.90 BRL");
  assert.equal(row.brand, "MyBrand");
  assert.equal(row.currency, "BRL");
});

test("toFeedRow handles missing description", () => {
  const input = {
    product: {
      id: "prod_456",
      name: "Widget",
      variants: [
        {
          basePriceInCents: 5000,
          currency: "BRL",
          media: [],
          stockQuantity: 0,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.description, "");
  assert.equal(row.availability, "out_of_stock");
  assert.equal(row.image_link, "");
});

test("toFeedRow uses first in-stock variant when multiple exist", () => {
  const input = {
    product: {
      id: "prod_789",
      name: "Multi-variant",
      variants: [
        {
          basePriceInCents: 10000,
          currency: "BRL",
          media: [],
          stockQuantity: 0,
          stockReserved: 0,
        },
        {
          basePriceInCents: 8000,
          currency: "BRL",
          media: [{ url: "https://example.com/img2.jpg", type: "IMAGE" as const }],
          stockQuantity: 10,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
    brandName: "Brand",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.price, "80.00 BRL");
  assert.equal(row.availability, "in_stock");
});

test("toFeedRow returns null when product has no variants", () => {
  const input = {
    product: {
      id: "prod_empty",
      name: "No variants",
      variants: [],
    },
    merchantId: "mrc_1",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.equal(row, null);
});

test("toFeedRow falls back to merchant id when brand is missing", () => {
  const input = {
    product: {
      id: "prod_noBrand",
      name: "Test",
      variants: [
        {
          basePriceInCents: 1000,
          currency: "BRL",
          media: [],
          stockQuantity: 1,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_fallback",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.brand, "mrc_fallback");
});

test("toFeedRow omits link when slug is missing", () => {
  const input = {
    product: {
      id: "prod_noSlug",
      name: "No slug",
      variants: [
        {
          basePriceInCents: 1000,
          currency: "BRL",
          media: [],
          stockQuantity: 1,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
    publicBaseUrl: "https://store.example.com",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.link, "");
});

test("toFeedRow picks first IMAGE media by order", () => {
  const input = {
    product: {
      id: "prod_multiMedia",
      name: "Video + images",
      variants: [
        {
          basePriceInCents: 1000,
          currency: "BRL",
          media: [
            { url: "https://example.com/video.mp4", type: "VIDEO" as const, order: 0 },
            { url: "https://example.com/img1.jpg", type: "IMAGE" as const, order: 1 },
            { url: "https://example.com/img0.jpg", type: "IMAGE" as const, order: 0 },
          ],
          stockQuantity: 1,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);
  assert.equal(row.image_link, "https://example.com/img0.jpg");
});

test("toFeedRow FIELDS constant matches all row keys", () => {
  const input = {
    product: {
      id: "prod_check",
      name: "Check",
      variants: [
        {
          basePriceInCents: 1000,
          currency: "BRL",
          media: [],
          stockQuantity: 1,
          stockReserved: 0,
        },
      ],
    },
    merchantId: "mrc_1",
    brandName: "Brand",
  };

  const row = ProductFeedMapper.toFeedRow(input);
  assert.ok(row);

  const fields = ProductFeedMapper.FIELDS as readonly (keyof typeof row)[];
  for (const field of fields) {
    assert.ok(field in row, `Field ${String(field)} missing from row`);
  }
});
