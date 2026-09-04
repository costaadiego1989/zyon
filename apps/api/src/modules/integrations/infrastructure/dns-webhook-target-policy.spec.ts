import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DnsWebhookTargetPolicy } from "./dns-webhook-target-policy.js";

describe("DnsWebhookTargetPolicy", () => {
  it("rejects loopback and private targets", async () => {
    const policy = new DnsWebhookTargetPolicy();
    await assert.rejects(
      policy.assertAllowed("https://127.0.0.1/hooks"),
      /webhook_private_network_forbidden/,
    );
    await assert.rejects(
      policy.assertAllowed("https://10.0.0.5/hooks"),
      /webhook_private_network_forbidden/,
    );
  });

  it("accepts a public HTTPS address and returns pinned addresses", async () => {
    const policy = new DnsWebhookTargetPolicy();
    const result = await policy.assertAllowed("https://8.8.8.8/hooks");
    assert.equal(result.url, "https://8.8.8.8/hooks");
    assert.deepEqual(result.pinnedAddresses, ["8.8.8.8"]);
  });
});
