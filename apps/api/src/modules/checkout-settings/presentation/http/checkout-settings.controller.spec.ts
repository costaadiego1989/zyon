import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryCheckoutSettingsRepository } from "../../infrastructure/in-memory-checkout-settings.repository.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "../../application/checkout-settings.use-cases.js";
import { CheckoutSettingsController } from "./checkout-settings.controller.js";

test("CheckoutSettingsController manages authenticated merchant settings", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const controller = new CheckoutSettingsController(
    new GetCheckoutSettingsUseCase(repository),
    new UpdateCheckoutSettingsUseCase(repository),
    new ResetCheckoutSettingsUseCase(repository),
    new GetCheckoutSettingsContextUseCase(repository)
  );
  const request = { user: { userId: "usr_1", merchantId: "mrc_1", email: "owner@example.com", role: "owner" } };

  const updated = await controller.update(request, {
    mode: "manual_only",
    widgetBehavior: { openWidgetOnTrigger: false }
  });
  const context = await controller.context(request);

  assert.equal(updated.mode, "manual_only");
  assert.equal(context.checkout_settings.mode, "manual_only");
  assert.equal(context.checkout_settings.open_widget_on_trigger, false);
});
