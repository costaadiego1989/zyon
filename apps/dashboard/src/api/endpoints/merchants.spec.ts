import { expect, test } from "vitest";
import { merchantEndpoints } from "./merchants.js";

test("submits product feedback through the authenticated merchant endpoint", async () => {
  const requests: Array<{ url: string; method?: string; body?: string | null; credentials?: RequestCredentials }> = [];
  const api = merchantEndpoints(
    "https://api.example.test/",
    (async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : null,
        credentials: init?.credentials,
      });
      return new Response(JSON.stringify({
        id: "feedback_1",
        category: "bug",
        createdAt: "2026-09-13T12:00:00.000Z",
      }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  );

  await expect(api.submitPlatformFeedback({
    category: "bug",
    message: "A imagem não aparece no catálogo.",
  })).resolves.toEqual({
    id: "feedback_1",
    category: "bug",
    createdAt: "2026-09-13T12:00:00.000Z",
  });

  expect(requests).toEqual([{
    url: "https://api.example.test/v1/merchants/me/platform-feedback",
    method: "POST",
    body: '{"category":"bug","message":"A imagem não aparece no catálogo."}',
    credentials: "include",
  }]);
});
