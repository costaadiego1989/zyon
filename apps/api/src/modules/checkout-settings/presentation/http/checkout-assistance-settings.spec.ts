import test from "node:test";
import assert from "node:assert/strict";
import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CheckoutSettingsEntity } from "../../domain/entities/checkout-settings.entity.js";
import { InMemoryCheckoutSettingsRepository } from "../../infrastructure/in-memory-checkout-settings.repository.js";
import { GetCheckoutSettingsUseCase, UpdateCheckoutSettingsUseCase } from "../../application/checkout-settings.use-cases.js";
import { CheckoutSettingsPublicController } from "./checkout-settings.controller.js";
import { CheckoutSettingsPatchDto } from "./checkout-settings.dto.js";

test("assistance flags survive validation and persistence without overwriting other flags or idle time", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const get = new GetCheckoutSettingsUseCase(repository), update = new UpdateCheckoutSettingsUseCase(repository);
  const controller = new CheckoutSettingsPublicController(get, { merchant: { findUnique: async () => null }, merchantRule: { findUnique: async () => null } } as never);
  assert.deepEqual((await controller.getWidgetConfig("merchant")).assistance, {
    pix: true, installments: true, unavailableProduct: true, humanHandoff: true,
  });
  await update.execute("merchant", { interventionPolicy: { idleSeconds: 240, assistance: { pix: false, humanHandoff: false } } });
  const dto = plainToInstance(CheckoutSettingsPatchDto, { interventionPolicy: { assistance: { installments: false } } });
  assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
  await update.execute("merchant", dto);
  const saved = await controller.getWidgetConfig("merchant");
  assert.equal(saved.idleSeconds, 240);
  assert.deepEqual(saved.assistance, { pix: false, installments: false, unavailableProduct: true, humanHandoff: false });
  assert.equal((await controller.getWidgetConfig("other")).assistance?.pix, true);
});

test("assistance rejects invalid booleans and unknown flags", async () => {
  for (const assistance of [{ pix: "false" }, { humanHandoff: 1 }, { invented: true }]) {
    const dto = plainToInstance(CheckoutSettingsPatchDto, { interventionPolicy: { assistance } });
    assert.ok((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length);
    assert.throws(() => CheckoutSettingsEntity.createDefault({ merchantId: "merchant" })
      .update({ interventionPolicy: { assistance: assistance as never } }), /checkout_assistance_invalid/);
  }
});

test("settings snapshots do not share mutable assistance flags", () => {
  const entity = CheckoutSettingsEntity.createDefault({ merchantId: "merchant" });
  const snapshot = entity.snapshot();
  snapshot.interventionPolicy.assistance!.pix = false;
  assert.equal(entity.snapshot().interventionPolicy.assistance?.pix, true);
});
