import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

// Static regression of every known row-lock wrapper, not a concurrency proof.
// Dedicated source/native cases exercise ordering, scope and actual lock waits.
const files = [
  "modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts",
  "modules/checkout/infrastructure/prisma/checkout-chat-request.service.ts",
  "modules/checkout/application/services/strategy-checkout-chat.service.ts",
  "modules/revenue-manager/infrastructure/incentive-execution-ledger.ts",
  "modules/revenue-manager/infrastructure/strategy-chat-publisher.ts",
  "modules/revenue-manager/infrastructure/strategy-execution-ledger.ts",
  "modules/storefront/infrastructure/repositories/prisma-storefront-telemetry.repository.ts",
  "modules/whatsapp-channel/application/use-cases/route-to-session.use-case.ts",
  "modules/payment/infrastructure/prisma-payment.repository.ts",
  "modules/payment/infrastructure/checkout-payment.adapter.ts",
  "modules/payment/application/prepare-marketplace-checkout.service.ts",
  "modules/coupons/application/use-cases/apply-coupon.use-case.ts",
  "modules/public-api/agentic-protocol/acp-checkout-update.service.ts",
  "modules/embed/application/update-marketplace-checkout-address.service.ts",
  "modules/marketplace/infrastructure/repositories/prisma-marketplace-unsubmitted-cancellation.repository.ts",
  "modules/marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.ts",
  "modules/shipping/application/use-cases/quote-marketplace-shipping.service.ts",
  "shared/bookings/service-slot-holds.service.ts",
];

for (const file of files) {
  test(`checkout anchor precedes every explicit row lock in ${file}`, () => {
    const text = readFileSync(resolve("src", file), "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rowLocks: ts.TaggedTemplateExpression[] = [];
    const anchors: ts.AwaitExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isTaggedTemplateExpression(node) && /\bcheckout_sessions\b/i.test(node.template.getText(source))
        && /\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i.test(node.template.getText(source))) rowLocks.push(node);
      if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)
        && node.expression.expression.getText(source) === "lockCheckoutSessionAnchor") anchors.push(node);
      ts.forEachChild(node, visit);
    };
    const owner = (node: ts.Node): ts.Node | undefined => {
      let cursor = node.parent;
      while (cursor && !ts.isFunctionLike(cursor)) cursor = cursor.parent;
      return cursor;
    };
    visit(source);
    if (file.includes("route-to-session")) assert.ok(anchors.length > 0, "checkout creation must participate even without a row lock");
    else assert.ok(rowLocks.length > 0, "keep the known row-lock inventory explicit");
    for (const row of rowLocks) {
      const position = source.getLineAndCharacterOfPosition(row.getStart(source));
      assert.ok(anchors.some(anchor => owner(anchor) === owner(row) && anchor.getStart(source) < row.getStart(source)),
        `missing awaited session anchor before ${file}:${position.line + 1}`);
    }
    assert.match(text, /import\s*\{\s*lockCheckoutSessionAnchor\s*\}\s*from\s*["'][^"']*checkout-session-lock\.js["']/);
  });
}
