import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NonProductionRoute, ProductionDisabledRoute } from "./non-production-route.js";
import { NonProductionRouteGuard } from "./non-production-route.guard.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalEnableLegacy = process.env.ENABLE_LEGACY_ROUTES;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalEnableLegacy === undefined) {
    delete process.env.ENABLE_LEGACY_ROUTES;
  } else {
    process.env.ENABLE_LEGACY_ROUTES = originalEnableLegacy;
  }
});

describe("NonProductionRouteGuard", () => {
  it("hides marked controllers in production", () => {
    process.env.NODE_ENV = "production";
    const Controller = markedController();
    const guard = new NonProductionRouteGuard(new Reflector());

    assert.throws(
      () => guard.canActivate(makeContext(Controller)),
      NotFoundException,
    );
  });

  it("allows marked controllers outside production", () => {
    process.env.NODE_ENV = "test";
    const guard = new NonProductionRouteGuard(new Reflector());

    assert.equal(guard.canActivate(makeContext(markedController())), true);
  });

  it("allows marked controllers in production when ENABLE_LEGACY_ROUTES is set", () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_LEGACY_ROUTES = "true";
    const guard = new NonProductionRouteGuard(new Reflector());

    assert.equal(guard.canActivate(makeContext(markedController())), true);
  });

  it("keeps explicitly disabled capabilities hidden even when legacy routes are enabled", () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_LEGACY_ROUTES = "true";
    const guard = new NonProductionRouteGuard(new Reflector());

    assert.throws(
      () => guard.canActivate(makeContext(productionDisabledController())),
      NotFoundException,
    );
  });

  it("allows unmarked controllers in production", () => {
    process.env.NODE_ENV = "production";
    const guard = new NonProductionRouteGuard(new Reflector());

    assert.equal(guard.canActivate(makeContext(class PublicController {})), true);
  });
});

function markedController(): Function {
  class LegacyController {}
  NonProductionRoute()(LegacyController);
  return LegacyController;
}

function productionDisabledController(): Function {
  class DisabledController {}
  ProductionDisabledRoute()(DisabledController);
  return DisabledController;
}

function makeContext(controller: Function) {
  return {
    getHandler: () => function handler() {},
    getClass: () => controller,
  } as never;
}
