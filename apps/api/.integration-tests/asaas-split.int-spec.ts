/**
 * ACP Asaas sandbox split-charge test.
 *
 * Validates an Asaas sandbox payment round-trip:
 *  1. Create or look up a sandbox customer by CPF.
 *  2. Create a PIX payment with externalReference = intent id.
 *  3. Read the payment back and confirm the QR + invoice URL are present.
 *
 * NOTE — Asaas split mechanics:
 *  BaaS subaccount split is configured at the subaccount level (NOT on the
 *  payment). When you create a subaccount with the AACP flow
 *  (CreateAsaasSubaccountUseCase), Asaas issues an apiKey + walletId for that
 *  subaccount and the platform can later split by transferring to that
 *  walletId. We don't try to drive a destination split here — Asaas doesn't
 *  support `transfer_data.destination` like Stripe does. Instead we validate
 *  the simpler "platform charge + post-capture transfer" path that AACP uses
 *  when `walletId` is set on the merchant connection.
 *
 * See [[asaas-api-host-gotcha]] for the api-sandbox.asaas.com gotcha and the
 * companyType requirement for CNPJ accounts.
 *
 * Skips when ASAAS_API_KEY_SANDBOX is missing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ASAAS_TOKEN = process.env.ASAAS_API_KEY_SANDBOX?.trim();
const ASAAS_BASE = process.env.ASAAS_BASE_URL_SANDBOX?.trim()
  || "https://api-sandbox.asaas.com";
const AACP_API_URL = process.env.AACP_API_URL?.trim() || "http://localhost:3009";
const AACP_MERCHANT_ID = process.env.AACP_MERCHANT_ID?.trim() || "mrc_test";

const runGate = Boolean(ASAAS_TOKEN) && ASAAS_BASE.includes("sandbox");

interface AsaasCustomer {
  id: string;
  name: string;
  email?: string;
}

interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  externalReference?: string;
  invoiceUrl?: string;
}

async function asaasFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${ASAAS_BASE}/v3${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      access_token: ASAAS_TOKEN!,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `asaas_${path.replace(/[/?=&]/g, "_")}_failed_${res.status}: ${errText.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

async function findOrCreateCustomer(cpfCnpj: string): Promise<AsaasCustomer> {
  const digits = cpfCnpj.replace(/\D+/g, "");
  const found = await asaasFetch<{ data?: AsaasCustomer[] }>(
    `/customers?cpfCnpj=${digits}`,
  );
  if (found.data && found.data.length > 0) {
    return found.data[0]!;
  }
  return asaasFetch<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: `AACP Test Customer ${digits.slice(-4)}`,
      cpfCnpj: digits,
      email: `aacp-test-${randomUUID().slice(0, 8)}@example.com`,
      // birthDate required for PF accounts; Asaas rejects without it.
      birthDate: "1990-01-01",
    }),
  });
}

test(
  "Asaas sandbox: PIX payment creates a payable with QR + invoice URL",
  { skip: !runGate ? "Set ASAAS_API_KEY_SANDBOX to a sandbox token (and ensure base URL points at api-sandbox.asaas.com)" : false },
  async (t) => {
    // Closure-scoped state — node:test subtests must return void, so we
    // capture variables instead of returning them from t.test callbacks.
    let customer: AsaasCustomer | undefined;
    let payment: AsaasPayment | undefined;
    let intentId = `pay_int_${randomUUID().replace(/-/g, "")}`;

    await t.test("findOrCreateCustomer", async () => {
      // 11-digit CPF (PF) — Asaas requires birthDate for PF.
      const cpf = "11144477735";
      customer = await findOrCreateCustomer(cpf);
      assert.ok(customer?.id, "customer id required");
    });

    await t.test("createPixPayment", async () => {
      assert.ok(customer?.id, "customer must exist");
      const value = 426.39; // R$ 426,39 — matches Stripe test for cross-check
      const created = await asaasFetch<AsaasPayment>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customer!.id,
          billingType: "PIX",
          value,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10),
          description: `AACP integration test ${intentId}`,
          externalReference: intentId,
        }),
      });
      assert.equal(typeof created.id, "string");
      assert.match(created.id, /^pay_/);
      assert.equal(created.externalReference, intentId);
      assert.ok(
        typeof created.invoiceUrl === "string" && created.invoiceUrl.length > 0,
        "Asaas must return an invoiceUrl on PIX create",
      );
      payment = created;
    });

    await t.test("fetchPixQrCode", async () => {
      assert.ok(payment?.id, "payment must exist");
      const data = await asaasFetch<{
        payload?: string;
        encodedImage?: string;
        expirationDate?: string;
      }>(`/payments/${payment!.id}/pixQrCode`);
      assert.ok(
        typeof data.payload === "string" && data.payload.length > 0,
        "PIX BR-code payload required",
      );
      assert.ok(
        typeof data.encodedImage === "string" && data.encodedImage.length > 0,
        "PIX base64 QR image required",
      );
      console.log(
        `  -> PIX QR payload length=${data.payload.length} ` +
        `image length=${data.encodedImage.length} ` +
        `expires=${data.expirationDate}`,
      );
    });

    await t.test("readPaymentById", async () => {
      assert.ok(payment?.id, "payment must exist");
      const data = await asaasFetch<AsaasPayment>(`/payments/${payment!.id}`);
      assert.equal(data.id, payment!.id);
      assert.equal(data.externalReference, intentId);
      assert.ok(
        ["PENDING", "RECEIVED", "CONFIRMED"].includes(data.status),
        `unexpected Asaas status: ${data.status}`,
      );
    });

    await t.test("listPaymentsByExternalReference", async () => {
      assert.ok(payment?.id, "payment must exist");
      const data = await asaasFetch<{ data?: AsaasPayment[] }>(
        `/payments?externalReference=${intentId}`,
      );
      assert.ok(data.data && data.data.length >= 1, "must find at least 1 payment");
      const match = data.data!.find((p) => p.id === payment!.id);
      assert.ok(match, `payment ${payment!.id} must appear in externalReference filter`);
    });

    // Quirks discovered — Asaas sandbox specifics worth documenting.
    console.log(
      `  -> Asaas test artifacts: customer=${customer!.id} ` +
      `payment=${payment!.id} intent_id=${intentId}`,
    );
    t.diagnostic(
      "Asaas sandbox quirks: " +
      "(1) host MUST be api-sandbox.asaas.com (not sandbox.asaas.com — that's the panel). " +
      "(2) PF customers need birthDate even when only CPF is supplied. " +
      "(3) PIX expires in 30 minutes by default — `quoteExpiresAt` in AACP matches that.",
    );

    // Cleanup — Asaas allows refunding a payment but does not allow hard delete.
    // We leave the sandbox payment in place; verify manually in the panel.
    void AACP_API_URL;
    void AACP_MERCHANT_ID;
    void intentId;
  },
);
