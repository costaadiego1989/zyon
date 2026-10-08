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

test("idle duration survives DTO whitelisting, persistence and public widget configuration", async () => {
  const repository = new InMemoryCheckoutSettingsRepository();
  const get = new GetCheckoutSettingsUseCase(repository);
  const update = new UpdateCheckoutSettingsUseCase(repository);
  const controller = new CheckoutSettingsPublicController(get, {
    merchant: { findUnique: async () => null }, merchantRule: { findUnique: async () => null },
  } as never);
  assert.equal((await controller.getWidgetConfig("merchant")).idleSeconds, 180);
  const dto = plainToInstance(CheckoutSettingsPatchDto, { interventionPolicy: { idleSeconds: 600 } });
  assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
  assert.equal(dto.interventionPolicy?.idleSeconds, 600);
  await update.execute("merchant", dto);
  assert.equal((await get.execute("merchant")).interventionPolicy.idleSeconds, 600);
  assert.equal((await controller.getWidgetConfig("merchant")).idleSeconds, 600);
  assert.equal((await controller.getWidgetConfig("other-merchant")).idleSeconds, 180);
});

test("idle duration rejects invalid values through both HTTP validation and domain validation", async () => {
  for (const value of [0, 9, 3601, 60.5, NaN, Infinity]) {
    const dto = plainToInstance(CheckoutSettingsPatchDto, { interventionPolicy: { idleSeconds: value } });
    assert.ok((await validate(dto)).length > 0);
    assert.throws(() => CheckoutSettingsEntity.createDefault({ merchantId: "merchant" })
      .update({ interventionPolicy: { idleSeconds: value } }), /idle_seconds_out_of_range/);
  }
  for (const value of [10, 30, 300, 600, 3600]) {
    assert.equal(CheckoutSettingsEntity.createDefault({ merchantId: "merchant" })
      .update({ interventionPolicy: { idleSeconds: value } }).snapshot().interventionPolicy.idleSeconds, value);
  }
});
