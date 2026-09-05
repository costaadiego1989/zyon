import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";

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

class FakeUpdateCustomerUseCase {
  executed: any[] = [];
  async execute(input: any) {
    this.executed.push(input);
    return { ok: true };
  }
}

function makeController(repo: InMemoryCheckoutRepository) {
  const helper = new EmbedCheckoutGuardHelper(repo);
  const fakeUpdateCustomer = new FakeUpdateCustomerUseCase();
  const ctrl = new EmbedCheckoutController(
    {} as never,
    {} as never,
    {} as never,
    helper,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    fakeUpdateCustomer as never
  );
  return { ctrl, fakeUpdateCustomer };
}

function reqWithClaims(token: string) {
  const claims = TOKENS.verify(token)!;
  return { embedClaims: claims, headers: {} };
}

describe("EmbedCheckoutController.updateCustomer", () => {
  it("delegates to UpdateEmbedCustomerUseCase", async () => {
    const repo = new InMemoryCheckoutRepository();
    const { ctrl, fakeUpdateCustomer } = makeController(repo);
    const token = issueToken("mrc_a");
    const sessionId = embedCheckoutSessionId(TOKENS.verify(token));
    await repo.saveSession(checkoutSession({ merchantId: "mrc_a", sessionId }));

    const res = await ctrl.updateCustomer(reqWithClaims(token), {
      session_id: sessionId,
      customer: { fullName: "Joao Silva", email: "joao@teste.com", cpf: "123.456.789-00", phone: "21999999999" }
    });
    assert.deepEqual(res, { ok: true });
    assert.equal(fakeUpdateCustomer.executed.length, 1);
    assert.equal(fakeUpdateCustomer.executed[0].merchantId, "mrc_a");
    assert.equal(fakeUpdateCustomer.executed[0].sessionId, sessionId);
  });

  it("rejects when cpf is missing", async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.saveSession(checkoutSession({ merchantId: "mrc_a", sessionId: "chk_a" }));
    const { ctrl } = makeController(repo);
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
    const { ctrl } = makeController(repo);
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
    const { ctrl } = makeController(repo);
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
    const { ctrl } = makeController(repo);
    const token = issueToken("mrc_a");
    await assert.rejects(
      () => ctrl.updateCustomer(reqWithClaims(token), {
        session_id: embedCheckoutSessionId(TOKENS.verify(token)),
        customer: { fullName: "Joao", email: "x@y.com", cpf: "12345678900" }
      }),
      (err: any) => err instanceof UnauthorizedException && err.message === "embed_unknown_checkout_session"
    );
  });
});
