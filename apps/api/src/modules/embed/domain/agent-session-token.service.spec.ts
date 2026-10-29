import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AgentSessionTokenService, type AgentSessionTokenClaims } from "./agent-session-token.service.js";

const createService = (secret?: string) => {
  const secretBuffer = secret
    ? Buffer.from(secret, "utf8")
    : Buffer.from("test_secret_at_least_16_chars_long_!!", "utf8");
  return new AgentSessionTokenService({ value: secretBuffer });
};

describe("AgentSessionTokenService — Token Issuance & Verification", () => {
  describe("Sign and Verify (valid token)", () => {
    it("@regression: sign and verify round-trip with valid claims", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now,
        expires_at_unix: now + 3600,
        nonce: "abc-123",
      };

      const token = svc.sign(claims);
      assert.ok(token);
      assert.equal(token.split(".").length, 2, "Token should have exactly 2 parts (payload.sig)");

      const verified = svc.verify(token);
      assert.equal(verified.session_id, "proto_xyz");
      assert.equal(verified.merchant_id, "merchant_123");
      assert.equal(verified.agent_id, "agent_abc");
      assert.equal(verified.current_state, "idle");
      assert.equal(verified.nonce, "abc-123");
    });

    it("sign produces deterministic output (reproducible signature)", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now,
        expires_at_unix: now + 3600,
        nonce: "abc-123",
      };

      const token1 = svc.sign(claims);
      const token2 = svc.sign(claims);
      assert.equal(token1, token2, "Same claims should produce same token");
    });
  });

  describe("Token Expiry Validation", () => {
    it("@regression: reject token that has expired", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const expiredClaims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now - 100,
        expires_at_unix: now - 10, // expired 10 seconds ago
        nonce: "abc-123",
      };

      const token = svc.sign(expiredClaims);
      assert.throws(() => svc.verify(token), /agent_session_token_expired/);
    });

    it("@regression: reject token at exact expiry time", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const atExpiryClaiims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now - 100,
        expires_at_unix: now, // expires right now
        nonce: "abc-123",
      };

      const token = svc.sign(atExpiryClaiims);
      assert.throws(() => svc.verify(token), /agent_session_token_expired/);
    });

    it("@regression: accept token that is about to expire (within 1 sec)", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const soonExpiringClaims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now - 1800,
        expires_at_unix: now + 1, // expires in 1 second
        nonce: "abc-123",
      };

      const token = svc.sign(soonExpiringClaims);
      assert.doesNotThrow(() => svc.verify(token));
    });
  });

  describe("Token Tampering Detection", () => {
    it("@regression: reject token with wrong secret (invalid signature)", () => {
      const svc = createService("correct_secret_32_chars_ok!");
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now,
        expires_at_unix: now + 3600,
        nonce: "abc-123",
      };

      const token = svc.sign(claims);

      const wrongSecretSvc = createService("different_secret_32_chars_ok");
      assert.throws(() => wrongSecretSvc.verify(token));
    });

    it("@regression: reject malformed token (missing parts)", () => {
      const svc = createService();
      assert.throws(() => svc.verify("invalid"));
      assert.throws(() => svc.verify(""));
      assert.throws(() => svc.verify("only_one_part"));
    });

    it("@regression: reject token with 3 parts (JWT format tampered)", () => {
      const svc = createService();
      assert.throws(() => svc.verify("part1.part2.part3"));
    });

    it("@regression: reject token with wrong typ claim", () => {
      const svc = createService();
      const wrongTypeClaims = {
        typ: "wrong_type" as any,
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: 100,
        expires_at_unix: 2000,
        nonce: "abc-123",
      };

      const token = svc.sign(wrongTypeClaims);
      assert.throws(() => svc.verify(token));
    });
  });

  describe("Token Payload Integrity", () => {
    it("@regression: verify preserves all claims", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_session_abc_123",
        merchant_id: "merchant_premium_xyz",
        agent_id: "agent_gpt4_001",
        current_state: "negotiated",
        issued_at_unix: now - 300,
        expires_at_unix: now + 1800,
        nonce: "unique_nonce_xyz",
      };

      const token = svc.sign(claims);
      const verified = svc.verify(token);

      assert.equal(verified.typ, "aacp_agent_protocol_v1");
      assert.equal(verified.session_id, "proto_session_abc_123");
      assert.equal(verified.merchant_id, "merchant_premium_xyz");
      assert.equal(verified.agent_id, "agent_gpt4_001");
      assert.equal(verified.current_state, "negotiated");
      assert.equal(verified.issued_at_unix, now - 300);
      assert.equal(verified.expires_at_unix, now + 1800);
      assert.equal(verified.nonce, "unique_nonce_xyz");
    });
  });

  describe("Token Secret Requirements", () => {
    it("reject secret shorter than 16 characters", () => {
      assert.throws(() => {
        new AgentSessionTokenService({ value: Buffer.from("short", "utf8") });
      });
    });

    it("accept secret exactly 16 characters", () => {
      assert.doesNotThrow(() => {
        new AgentSessionTokenService({ value: Buffer.from("1234567890123456", "utf8") });
      });
    });

    it("accept secret longer than 16 characters", () => {
      assert.doesNotThrow(() => {
        new AgentSessionTokenService({ value: Buffer.from("1234567890123456789", "utf8") });
      });
    });
  });

  describe("Edge Cases", () => {
    it("empty nonce is allowed", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz",
        merchant_id: "merchant_123",
        agent_id: "agent_abc",
        current_state: "idle",
        issued_at_unix: now,
        expires_at_unix: now + 3600,
        nonce: "",
      };

      const token = svc.sign(claims);
      const verified = svc.verify(token);
      assert.equal(verified.nonce, "");
    });

    it("special characters in session_id, merchant_id, agent_id", () => {
      const svc = createService();
      const now = Math.floor(Date.now() / 1000);
      const claims: AgentSessionTokenClaims = {
        typ: "aacp_agent_protocol_v1",
        session_id: "proto_xyz-123_456.789",
        merchant_id: "merchant:premium@zyon",
        agent_id: "agent/openai/gpt-4",
        current_state: "idle",
        issued_at_unix: now,
        expires_at_unix: now + 3600,
        nonce: "nonce-with-special-chars_123",
      };

      const token = svc.sign(claims);
      const verified = svc.verify(token);
      assert.equal(verified.session_id, "proto_xyz-123_456.789");
      assert.equal(verified.merchant_id, "merchant:premium@zyon");
      assert.equal(verified.agent_id, "agent/openai/gpt-4");
    });
  });
});
