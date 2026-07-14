/**
 * Regression tests for embed ADR fixes:
 *  - B4 (P3): malformed allowed_origin → 400 not 500
 *  - B2 (P2): live transactional scopes require an allowedOrigin
 *  - New scopes: payment:intents:confirm and payment:intents:read are valid
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { IssueEmbedSessionUseCase } from "./issue-embed-session.use-case.js";
import { EmbedTokenService } from "../domain/embed-token.service.js";

const secret = Buffer.from("issue-spec-embed-secret-32chr!!!!");
function makeUseCase() {
  return new IssueEmbedSessionUseCase(new EmbedTokenService({ value: secret }));
}

describe("IssueEmbedSessionUseCase", () => {
  it("B4 — malformed allowed_origin throws BadRequestException (400), not a raw Error (500)", () => {
    const useCase = makeUseCase();
    assert.throws(
      () =>
        useCase.execute({
          merchantId: "mrc_1",
          ttlSeconds: 300,
          allowedOrigin: "not-a-url",
        }),
      (err) => {
        assert.ok(err instanceof BadRequestException, "expected BadRequestException");
        return true;
      },
    );
  });

  it("B4 — non-https http origin (not localhost) throws BadRequestException", () => {
    const useCase = makeUseCase();
    assert.throws(
      () =>
        useCase.execute({
          merchantId: "mrc_1",
          ttlSeconds: 300,
          allowedOrigin: "http://shop.example",
        }),
      (err) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });

  it("B4 — localhost http origin is accepted", () => {
    const useCase = makeUseCase();
    const result = useCase.execute({
      merchantId: "mrc_1",
      ttlSeconds: 300,
      allowedOrigin: "http://localhost:3000",
    });
    const claims = new EmbedTokenService({ value: secret }).verify(result.embed_session_token);
    assert.equal(claims.allowedOrigin, "http://localhost:3000");
  });

  it("C1 — live environment + transactional scope without origin throws BadRequestException", () => {
    const useCase = makeUseCase();
    assert.throws(
      () =>
        useCase.execute({
          merchantId: "mrc_1",
          ttlSeconds: 300,
          environment: "live",
          scopes: ["payment:intents:create"],
          // no allowedOrigin
        }),
      (err) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });

  it("B2 — live environment + transactional scope WITH origin succeeds", () => {
    const useCase = makeUseCase();
    const result = useCase.execute({
      merchantId: "mrc_1",
      ttlSeconds: 300,
      environment: "live",
      scopes: ["payment:intents:create"],
      allowedOrigin: "https://shop.example",
    });
    const claims = new EmbedTokenService({ value: secret }).verify(result.embed_session_token);
    assert.equal(claims.allowedOrigin, "https://shop.example");
    assert.deepEqual(claims.scopes, ["payment:intents:create"]);
  });

  it("C1 — transactional scope without origin is rejected regardless of environment", () => {
    const useCase = makeUseCase();
    assert.throws(
      () =>
        useCase.execute({
          merchantId: "mrc_1",
          ttlSeconds: 300,
          environment: "test",
          scopes: ["payment:intents:create"],
        }),
      (err) => {
        assert.ok(err instanceof BadRequestException);
        return true;
      },
    );
  });

  it("new scopes payment:intents:confirm and payment:intents:read are accepted", () => {
    const useCase = makeUseCase();
    const result = useCase.execute({
      merchantId: "mrc_1",
      ttlSeconds: 300,
      allowedOrigin: "https://shop.example",
      scopes: ["payment:intents:create", "payment:intents:confirm", "payment:intents:read"],
    });
    const claims = new EmbedTokenService({ value: secret }).verify(result.embed_session_token);
    assert.deepEqual(claims.scopes, ["payment:intents:create", "payment:intents:confirm", "payment:intents:read"]);
  });
});
