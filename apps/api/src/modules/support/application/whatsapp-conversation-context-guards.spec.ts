import assert from "node:assert/strict";
import test from "node:test";
import { conversationContext } from "./whatsapp-conversation-context.js";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";

test("T58 minimal context projects only the verified current human principal", () => {
  for (const role of ["owner", "admin", "staff"] as const) {
    const principal = { kind: "human", tenantId: "tenant-current", userId: "operator-current", email: "private@example.test", role } as const;
    const result = conversationContext(principal, {});
    assert.deepEqual(result, { merchant_id: principal.tenantId, user_id: principal.userId, role: role.toUpperCase() });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result).sort(), ["merchant_id", "role", "user_id"]);
  }
});

test("T58 context rejects machines, missing identity and caller-selected authority", () => {
  const human = { kind: "human", tenantId: "current", userId: "operator", email: "private@example.test", role: "staff" } as const;
  const forbidden = [
    { kind: "service", tenantId: "current", credentialId: "key", environment: "test", scopes: ["support:read"] },
    { ...human, role: "buyer" }, { ...human, tenantId: "" }, { ...human, userId: " " },
  ];
  for (const principal of forbidden) assert.throws(() => conversationContext(principal as TenantPrincipal, {}));
  for (const query of [null, [], { role: "OWNER" }, { merchant_id: "foreign" }, { plan: "BOTH" }]) {
    assert.throws(() => conversationContext(human, query));
  }
});
