import "reflect-metadata";
import assert from "node:assert/strict";
import { MODULE_METADATA } from "@nestjs/common/constants.js";

const [mode, order, ...extra] = process.argv.slice(2);
assert.ok(["--source", "--compiled"].includes(mode) && ["payment-first", "checkout-first", "app-root"].includes(order) && !extra.length,
  "explicit_module_cycle_mode_and_order_required");
assert.equal(process.env.NODE_ENV, "test", "module_import_worker_requires_clean_test_environment");
for (const name of ["DATABASE_URL", "DIRECT_URL", "REDIS_URL", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "STRIPE_SECRET_KEY",
  "ASAAS_API_KEY", "NODE_OPTIONS", "DOTENV_CONFIG_PATH"]) {
  assert.equal(process.env[name], undefined, "module_import_worker_environment_not_clean");
}
const root = mode === "--source" ? "../src/" : "../dist/";
const suffix = mode === "--source" ? ".ts" : ".js";
const load = path => import(new URL(root + path + suffix, import.meta.url));
let appModule;
if (order === "app-root") {
  ({ AppModule: appModule } = await load("app.module"));
  assert.equal(typeof appModule, "function", "canonical_app_module_export_missing");
}
const names = order === "payment-first" ? ["payment", "checkout", "notifications"] : ["checkout", "payment", "notifications"];
const modules = new Map();
for (const name of names) modules.set(name, await load(`modules/${name}/${name}.module`));
const { PaymentModule } = modules.get("payment"), { CheckoutModule } = modules.get("checkout"),
  { NotificationsModule } = modules.get("notifications");
const imports = type => Reflect.getMetadata(MODULE_METADATA.IMPORTS, type);
const unwrap = value => value && typeof value === "object" && typeof value.forwardRef === "function" ? value.forwardRef() : value;
if (appModule) {
  const rootImports = imports(appModule).map(unwrap);
  assert.ok([PaymentModule, CheckoutModule, NotificationsModule].every(module => rootImports.includes(module)), "canonical_app_module_import_missing");
}
const notificationImports = imports(NotificationsModule);
assert.ok(notificationImports.every(value => unwrap(value) !== undefined), "undefined_notifications_import");
const paymentEdge = notificationImports.find(value => unwrap(value) === PaymentModule);
assert.ok(paymentEdge && typeof paymentEdge.forwardRef === "function", "notifications_payment_edge_must_be_deferred");
assert.ok(imports(PaymentModule).some(value => unwrap(value) === CheckoutModule), "payment_checkout_import_missing");
assert.ok(imports(CheckoutModule).some(value => unwrap(value) === NotificationsModule), "checkout_notifications_import_missing");
const { OrderQuotaService } = await load("modules/payment/application/services/order-quota.service");
const { OrderQuotaNoticeValidityService } = await load("modules/notifications/application/services/order-quota-notice-validity.service");
const { ORDER_QUOTA_NOTICE_VALIDITY } = await load("modules/notifications/domain/ports/order-quota-notice.port");
assert.ok(Reflect.getMetadata(MODULE_METADATA.EXPORTS, PaymentModule).includes(OrderQuotaService), "quota_service_export_missing");
assert.ok(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, NotificationsModule).some(value => value && typeof value === "object"
  && value.provide === ORDER_QUOTA_NOTICE_VALIDITY && value.useClass === OrderQuotaNoticeValidityService), "quota_validity_provider_missing");
if (mode === "--compiled") {
  const parameters = Reflect.getMetadata("design:paramtypes", OrderQuotaNoticeValidityService);
  assert.ok(Array.isArray(parameters) && parameters[0] === OrderQuotaService, "compiled_decorator_metadata_not_preserved");
}
console.log(JSON.stringify({ mode, order, moduleImports: "resolved", quotaProvider: "preserved",
  emittedDecoratorMetadata: mode === "--compiled" ? "verified" : "not_asserted_source_loader", fullNestBoot: false }));
