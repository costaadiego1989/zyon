import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

test("programmatic file worker inherits loopback guard and no integration credentials", async () => {
  assert.throws(() => net.connect({ host: "192.0.2.1", port: 443 }), /test_external_network_forbidden/);
  await assert.rejects(fetch("https://example.com"), /test_external_network_forbidden/);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.AACP_RUN_PRISMA_TESTS, "0");
  assert.equal(process.env.RUN_REAL_AI_E2E, "false");
});
