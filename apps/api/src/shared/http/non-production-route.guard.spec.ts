import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NonProductionRoute } from "./non-production-route.js";
import { NonProductionRouteGuard } from "./non-production-route.guard.js";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
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

function makeContext(controller: Function) {
  return {
    getHandler: () => function handler() {},
    getClass: () => controller,
  } as never;
}
