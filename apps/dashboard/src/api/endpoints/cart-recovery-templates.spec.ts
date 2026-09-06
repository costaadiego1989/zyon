import { describe, expect, it, vi } from "vitest";
import { getRecoveryTemplates, saveRecoveryTemplates, type RecoveryTemplates } from "./cart-recovery-templates.js";
import { DashboardHttpError } from "../http/error.js";

const templates: RecoveryTemplates = {
  email: { subject: "Seu carrinho", body: "Retorne {{link}}" },
  whatsapp: { body: "Olá {{buyerName}}, {{link}}", revision: 4, status: "submitted", rejectionReason: null },
  whatsappConnected: true, effectiveChannel: "email",
};

describe("recovery templates API", () => {
  it("reads the authenticated merchant's current approval state", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(templates)));
    expect(await getRecoveryTemplates("https://api.example.test", fetchImpl)).toEqual(templates);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/cart-recovery/templates");
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("sends editable content and the expected revision, excluding approval/tenant claims", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(templates)));
    await saveRecoveryTemplates("https://api.example.test", templates, fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("PUT");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toEqual({ email: templates.email,
      whatsapp: { body: templates.whatsapp.body, revision: 4 } });
  });

  it("preserves revision conflicts for readable conflict handling", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("template_revision_conflict", { status: 409 }));
    await expect(saveRecoveryTemplates("https://api.example.test", templates, fetchImpl))
      .rejects.toMatchObject({ status: 409, responseBody: "template_revision_conflict" } satisfies Partial<DashboardHttpError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not infer approval on an unavailable server", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(getRecoveryTemplates("https://api.example.test", fetchImpl)).rejects.toMatchObject({ status: 503 });
  });
});
