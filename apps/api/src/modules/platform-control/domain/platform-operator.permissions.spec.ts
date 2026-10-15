import assert from "node:assert/strict";
import test from "node:test";
import { hasPlatformPermission, PLATFORM_OPERATOR_ROLES, PLATFORM_PERMISSIONS } from "./platform-operator.js";

test("reserves operator-directory read access for the platform administrator and excludes management from V1", () => {
  for (const role of PLATFORM_OPERATOR_ROLES) {
    assert.equal(hasPlatformPermission(role, "platform:operators:read"), role === "platform_admin");
  }
  assert.equal(PLATFORM_PERMISSIONS.includes("platform:operators:write" as never), false);
});
