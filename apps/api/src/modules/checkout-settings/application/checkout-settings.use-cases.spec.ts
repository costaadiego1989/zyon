import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryCheckoutSettingsRepository } from "../infrastructure/in-memory-checkout-settings.repository.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "./checkout-settings.use-cases.js";

test("checkout settings use cases create defaults, update partially, and expose safe context", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const getSettings = new GetCheckoutSettingsUseCase(repository);
  const updateSettings = new UpdateCheckoutSettingsUseCase(repository);
  const getContext = new GetCheckoutSettingsContextUseCase(repository);

  const defaults = await getSettings.execute("mrc_1");
  assert.equal(defaults.merchantId, "mrc_1");
  assert.equal(defaults.mode, "silent_until_trigger");

  const updated = await updateSettings.execute("mrc_1", {
    mode: "proactive",
    interventionPolicy: { cooldownSeconds: 180 },
    handoff: { enabled: false }
  });
  const context = await getContext.execute("mrc_1");

  assert.equal(updated.mode, "proactive");
  assert.equal(updated.interventionPolicy.cooldownSeconds, 180);
  assert.equal(context.checkout_settings.mode, "proactive");
  assert.equal(context.checkout_settings.handoff_enabled, false);
  assert.equal("createdAt" in context.checkout_settings, false);
});

test("checkout settings reset restores defaults", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const updateSettings = new UpdateCheckoutSettingsUseCase(repository);
  const resetSettings = new ResetCheckoutSettingsUseCase(repository);

  await updateSettings.execute("mrc_1", { mode: "manual_only" });
  const reset = await resetSettings.execute("mrc_1");

  assert.equal(reset.mode, "silent_until_trigger");
  assert.equal(reset.widgetBehavior.openWidgetOnTrigger, true);
});

test("checkout settings remain isolated by merchant", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const updateSettings = new UpdateCheckoutSettingsUseCase(repository);
  const getSettings = new GetCheckoutSettingsUseCase(repository);

  await updateSettings.execute("mrc_1", { mode: "manual_only" });
  const other = await getSettings.execute("mrc_2");

  assert.equal(other.mode, "silent_until_trigger");
});
