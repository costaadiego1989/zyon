import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

const TOKENS = new EmbedTokenService({ value: Buffer.from("embed-ctrl-spec-secret-32chars!!!") });

function issueToken(merchantId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return TOKENS.sign({
    typ: "aacp_embed_v1",
    merchantId,
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n1"
  });
}

function makeController(repo: InMemoryCheckoutRepository) {
  const helper = new EmbedCheckoutGuardHelper(repo);
  return new EmbedCheckoutController(
    {} as never,
    {} as never,
    {} as never,
    helper,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

function reqWithClaims(token: string) {
  const claims = TOKENS.verify(token)!;
  return { embedClaims: claims, headers: {} };
}

describe("EmbedCheckoutController.updateCustomer", () => {
  it("persists customer data on the session", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ merchantId: "mrc_a", sessionId: "chk_a" }));
    const ctrl = makeController(repo);
    const token = issueToken("mrc_a");

    const res = await ctrl.updateCustomer(reqWithClaims(token), {
      session_id: "chk_a",
      customer: { fullName: "Joao Silva", email: "joao@teste.com", cpf: "123.456.789-00", phone: "21999999999" }
    });
    assert.deepEqual(res, { ok: true });

    const persisted = await repo.getSession("mrc_a", "chk_a");
    assert.equal(persisted?.customer?.fullName, "Joao Silva");
    assert.equal(persisted?.customer?.email, "joao@teste.com");
    assert.equal(persisted?.customer?.cpf, "12345678900");
    assert.equal(persisted?.customer?.phone, "21999999999");
  });

  it("rejects when cpf is missing", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ merchantId: "mrc_a", sessionId: "chk_a" }));
    const ctrl = makeController(repo);
    const token = issueToken("mrc_a");

    await assert.rejects(
      () => ctrl.updateCustomer(reqWithClaims(token), {
        session_id: "chk_a",
        customer: { fullName: "Joao", email: "x@y.com" }
      }),
      (err: any) => err instanceof BadRequestException && err.message === "cpf_required"
    );
  });

  it("rejects when session_id is missing", async () => {
    const repo = new InMemoryCheckoutRepository();
    const ctrl = makeController(repo);
    const token = issueToken("mrc_a");
    await assert.rejects(
      () => ctrl.updateCustomer(reqWithClaims(token), {
        customer: { fullName: "Joao", email: "x@y.com", cpf: "12345678900" }
      } as any),
      (err: any) => err instanceof BadRequestException && err.message === "session_id_required"
    );
  });

  it("rejects when session belongs to another merchant", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ merchantId: "mrc_b", sessionId: "chk_b" }));
    const ctrl = makeController(repo);
    const token = issueToken("mrc_a");

    await assert.rejects(
      () => ctrl.updateCustomer(reqWithClaims(token), {
        session_id: "chk_b",
        customer: { fullName: "Joao", email: "x@y.com", cpf: "12345678900" }
      }),
      (err: any) => err instanceof UnauthorizedException
    );
  });

  it("returns 404-style Unauthorized when session is unknown", async () => {
    const repo = new InMemoryCheckoutRepository();
    const ctrl = makeController(repo);
    const token = issueToken("mrc_a");
    await assert.rejects(
      () => ctrl.updateCustomer(reqWithClaims(token), {
        session_id: "chk_missing",
        customer: { fullName: "Joao", email: "x@y.com", cpf: "12345678900" }
      }),
      (err: any) => err instanceof UnauthorizedException && err.message === "embed_unknown_checkout_session"
    );
  });
});
