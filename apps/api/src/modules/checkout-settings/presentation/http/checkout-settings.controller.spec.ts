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
import { EntityTagService } from "../../../../shared/http/entity-tag.service.js";
import type { Response } from "express";

test("CheckoutSettingsController manages authenticated merchant settings", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const controller = new CheckoutSettingsController(
    new GetCheckoutSettingsUseCase(repository),
    new UpdateCheckoutSettingsUseCase(repository),
    new ResetCheckoutSettingsUseCase(repository),
    new GetCheckoutSettingsContextUseCase(repository),
    new EntityTagService(),
  );
  const request = {
    tenantPrincipal: {
      kind: "human" as const,
      tenantId: "mrc_1",
      userId: "usr_1",
      email: "owner@example.com",
      role: "owner" as const,
    },
  };
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response;

  await controller.get(request, response);
  const updated = await controller.update(
    request,
    response,
    headers.ETag,
    {
      mode: "manual_only",
      widgetBehavior: { openWidgetOnTrigger: false },
    },
  );
  const context = await controller.context(request);

  assert.equal(updated.mode, "manual_only");
  assert.equal(context.checkout_settings.mode, "manual_only");
  assert.equal(context.checkout_settings.open_widget_on_trigger, false);
});
