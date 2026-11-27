import { expect, it } from "vitest";
import { fiscalEndpoints, FiscalApiError } from "./fiscal.js";

for (const response of [null, {}, "empty-body"]) {
  it(`FISCAL-UI-02 absent connection has no phantom provider: ${JSON.stringify(response)}`, async () => {
    const api = fiscalEndpoints("https://fiscal.test/v1", async () => response === "empty-body" ? new Response("") : Response.json(response));
    expect(await api.getFiscalConnection("production")).toBeNull();
  });
}

it("FISCAL-UI-05 nonempty malformed connection is a failure rather than absence", async () => {
  const api = fiscalEndpoints("https://fiscal.test/v1", async () => Response.json({ unexpected: "private-response" }));
  await expect(api.getFiscalConnection("production")).rejects.toMatchObject({ status: 502, kind: "unavailable", code: "fiscal_response_invalid" });
  await expect(api.getFiscalConnection("production")).rejects.toBeInstanceOf(FiscalApiError);
});
