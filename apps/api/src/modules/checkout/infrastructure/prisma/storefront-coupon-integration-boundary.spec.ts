import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as admission from "../../../../shared/persistence/storefront-coupon/admission.js";
import * as contracts from "../../../../shared/persistence/storefront-coupon/contracts.js";
import * as generation from "../../../../shared/persistence/storefront-coupon/generation-release.js";
import * as fence from "../../../../shared/persistence/storefront-coupon/cart-owner-fence.js";
import * as oldAdmission from "../../../coupons/infrastructure/repositories/prisma-storefront-coupon-admission.js";
import * as oldGeneration from "./prisma-checkout-coupon-release.js";
import * as oldFence from "../../../storefront/infrastructure/repositories/storefront-checkout-binding-fence.js";
import { PrismaPaymentRepository } from "../../../payment/infrastructure/prisma-payment.repository.js";
import { createNormalCrossSellPaymentAdmission } from "../../../payment/infrastructure/prisma-normal-cross-sell-payment-admission.js";
import { readNormalCheckoutCrossSellAuthority } from "../../../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";
import { projectNormalCrossSellCart } from "../../../cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";

// Test commands run per app; the compiled registry must inspect the same
// checked-out source contracts, not search for .ts files beside compiled JS.
const sourceSpecUrl = pathToFileURL(resolve("src/modules/checkout/infrastructure/prisma/storefront-coupon-integration-boundary.spec.ts"));

test("legacy admission imports retain exact function and error identity, without duplicate implementations", () => {
  assert.equal(oldAdmission.captureStorefrontCouponForPayment, admission.captureStorefrontCouponForPayment);
  assert.equal(oldAdmission.readStorefrontCouponForCheckout, admission.readStorefrontCouponForCheckout);
  assert.equal(oldAdmission.StorefrontCouponEligibilityReviewRequired, contracts.StorefrontCouponEligibilityReviewRequired);
});
test("legacy generation and storefront fence imports resolve the canonical ESM implementations", () => {
  for (const key of Object.keys(generation) as Array<keyof typeof generation>) assert.equal(oldGeneration[key], generation[key]);
  for (const key of Object.keys(fence) as Array<keyof typeof fence>) assert.equal(oldFence[key], fence[key]);
});

function source(relativePath: string) {
  const url = new URL(relativePath, sourceSpecUrl);
  return ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
}
function property(node: ts.ObjectLiteralExpression, name: string) {
  return node.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && item.name.getText() === name)?.initializer;
}
function registration(file: ts.SourceFile, token: string): ts.ObjectLiteralExpression {
  let result: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node) && property(node, "provide")?.getText() === token) result = node;
    ts.forEachChild(node, visit);
  }
  visit(file); assert.ok(result, `missing_provider_${token}`); return result;
}
function assertPaymentWiring(file: ts.SourceFile) {
  const provider = registration(file, "PAYMENT_REPOSITORY");
  assert.equal(property(provider, "inject")?.getText(), "[PRISMA_CLIENT]");
  const factory = property(provider, "useFactory");
  assert.ok(factory && ts.isArrowFunction(factory) && ts.isNewExpression(factory.body));
  assert.deepEqual(factory.parameters.map(parameter => parameter.name.getText()), ["prisma"]);
  assert.equal(factory.parameters[0]?.type?.getText(), "PrismaClient");
  assert.equal(factory.body.expression.getText(), "PrismaPaymentRepository");
  const args = factory.body.arguments; assert.ok(args); assert.equal(args.length, 4);
  assert.deepEqual(args.slice(0, 3).map(argument => argument.getText()), ["prisma", "captureStorefrontCouponForPayment", "undefined"]);
  const admissionFactory = args[3]; assert.ok(admissionFactory && ts.isCallExpression(admissionFactory));
  assert.equal(admissionFactory.expression.getText(), "createNormalCrossSellPaymentAdmission");
  assert.equal(admissionFactory.arguments.length, 1);
  const callback = admissionFactory.arguments[0]; assert.ok(callback && ts.isArrowFunction(callback));
  assert.ok(callback.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
  assert.deepEqual(callback.parameters.map(parameter => parameter.name.getText()), ["tx", "scope", "options"]);
  assert.ok(ts.isBlock(callback.body)); assert.equal(callback.body.statements.length, 2);
  const [read, returned] = callback.body.statements;
  assert.ok(read && ts.isVariableStatement(read)); assert.ok(read.declarationList.flags & ts.NodeFlags.Const);
  assert.equal(read.declarationList.declarations.length, 1);
  const current = read.declarationList.declarations[0]; assert.ok(current); assert.equal(current.name.getText(), "current");
  assert.ok(current.initializer && ts.isAwaitExpression(current.initializer) && ts.isCallExpression(current.initializer.expression));
  const canonicalRead = current.initializer.expression;
  assert.equal(canonicalRead.expression.getText(), "readNormalCheckoutCrossSellAuthority");
  assert.deepEqual(canonicalRead.arguments.map(argument => argument.getText()), ["tx", "scope", "undefined", "options"]);
  assert.ok(returned && ts.isReturnStatement(returned) && returned.expression && ts.isObjectLiteralExpression(returned.expression));
  assert.equal(returned.expression.properties.length, 2);
  const spread = returned.expression.properties[0]; assert.ok(spread && ts.isSpreadAssignment(spread));
  assert.equal(spread.expression.getText(), "current");
  const projection = property(returned.expression, "projectedCart"); assert.ok(projection && ts.isCallExpression(projection));
  assert.equal(projection.expression.getText(), "projectNormalCrossSellCart");
  assert.deepEqual(projection.arguments.map(argument => argument.getText()), ["current"]);
}

test("PaymentModule registration supplies original Prisma/coupon authority and exact normal canonical admission without enabling widget B", () => {
  // AST registration plus real constructor identity; not Nest DI/HTTP boot.
  assertPaymentWiring(source("../../../payment/payment.module.ts"));
  const syntheticPrisma = Object.freeze({}) as PrismaClient;
  const captureNormal = createNormalCrossSellPaymentAdmission(async (tx, scope, options) => {
    const current = await readNormalCheckoutCrossSellAuthority(tx, scope, undefined, options);
    return { ...current, projectedCart: projectNormalCrossSellCart(current) };
  });
  const repository = new PrismaPaymentRepository(syntheticPrisma, oldAdmission.captureStorefrontCouponForPayment, undefined, captureNormal);
  assert.equal(Reflect.get(repository, "prisma"), syntheticPrisma);
  assert.equal(Reflect.get(repository, "captureCoupon"), admission.captureStorefrontCouponForPayment);
  assert.equal(Reflect.get(repository, "captureWidgetCheckout"), undefined);
  assert.equal(Reflect.get(repository, "captureNormalCrossSell"), captureNormal);
});

for (const [name, before, after] of [
  ["fake admission callback", "const current=await readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options);", "const current=await fakeCanonicalReader(tx,scope,undefined,options);"],
  ["foreign scope", "readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options)", "readNormalCheckoutCrossSellAuthority(tx,{merchantId:'foreign',sessionId:'foreign'},undefined,options)"],
  ["detached transaction", "readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options)", "readNormalCheckoutCrossSellAuthority(prisma,scope,undefined,options)"],
  ["dropped first-send options", "readNormalCheckoutCrossSellAuthority(tx,scope,undefined,options)", "readNormalCheckoutCrossSellAuthority(tx,scope,undefined,undefined)"],
  ["fake cart projection", "projectedCart:projectNormalCrossSellCart(current)", "projectedCart:current.cart"],
  ["extra constructor argument", "new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment,undefined,", "new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment,undefined,undefined,"],
] as const) test(`payment registration rejects ${name} instead of accepting arbitrary extra arguments`, () => {
  const file = source("../../../payment/payment.module.ts"), changed = file.text.replace(before, after);
  assert.notEqual(changed, file.text, "negative_wiring_canary_must_change_fixture");
  assert.throws(() => assertPaymentWiring(ts.createSourceFile(file.fileName, changed, ts.ScriptTarget.Latest, true)));
});
test("CheckoutModule retains the existing session alias and dedicated Prisma commands after ESM extraction", () => {
  const file = source("../../checkout.module.ts");
  const provider = registration(file, "CHECKOUT_REPOSITORY");
  assert.equal(property(provider, "inject")?.getText(), "[PRISMA_CLIENT, OrderQuotaService]");
  assert.equal(property(registration(file, "CHECKOUT_SESSION_REPOSITORY"), "useExisting")?.getText(), "CHECKOUT_REPOSITORY");
  const repository = new PrismaCheckoutRepository(Object.freeze({}) as PrismaClient);
  for (const key of ["commitCommercialMutation", "reopenForBuyerEdit", "prepareStorefrontCouponBenefits", "hasReleasedStorefrontCouponBinding"]) {
    assert.equal(typeof Reflect.get(repository, key), "function");
  }
});
test("shared integration runtime graph has no ESM cycle or back edge into aggregate repository roots", () => {
  const visited = new Set<string>(), active = new Set<string>();
  function walk(url: URL) {
    assert.equal(active.has(url.href), false, `runtime_cycle_${url.pathname}`);
    if (visited.has(url.href)) return;
    assert.ok(visited.size < 200, "unexpected_integration_graph_expansion");
    visited.add(url.href); active.add(url.href);
    const file = ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly || ts.isImportDeclaration(statement) && (statement.importClause?.isTypeOnly
        || statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
          && !statement.importClause.name && statement.importClause.namedBindings.elements.every(element => element.isTypeOnly))) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
      const child = new URL(specifier.text.endsWith(".js") ? specifier.text.slice(0, -3) + ".ts" : specifier.text, url);
      if (!existsSync(child)) continue;
      assert.equal(child.pathname.endsWith(".module.ts") || child.pathname.endsWith("prisma-checkout.repository.ts")
        || child.pathname.endsWith("prisma-payment.repository.ts"), false, `aggregate_root_backedge_${child.pathname}`);
      walk(child);
    }
    active.delete(url.href);
  }
  for (const name of ["admission", "generation-release", "cart-owner-fence", "contracts"]) {
    walk(new URL(`../../../../shared/persistence/storefront-coupon/${name}.ts`, sourceSpecUrl));
  }
  assert.ok(visited.size >= 4);
});
