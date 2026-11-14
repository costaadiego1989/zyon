import { describe, expect, it } from "vitest";
import { dashboardJson } from "./client.js";
import { DashboardHttpError } from "./error.js";

describe("dashboardJson", () => {
  it("preserves a rate-limit retry interval from the response header", async () => {
    const fetchImpl = async () => new Response(
      JSON.stringify({ message: "rate_limit_exceeded", retryAfterSeconds: 7 }),
      { status: 429, headers: { "Retry-After": "7" } },
    );

    await expect(dashboardJson("https://api.example.test", "/reviews", {}, fetchImpl as typeof fetch))
      .rejects.toMatchObject({ status: 429, retryAfterSeconds: 7 });
  });

  it("uses the API retry interval when a proxy removes the response header", async () => {
    const fetchImpl = async () => new Response(
      JSON.stringify({ retry_after_seconds: 12 }),
      { status: 429 },
    );

    await expect(dashboardJson("https://api.example.test", "/reviews", {}, fetchImpl as typeof fetch))
      .rejects.toMatchObject({ status: 429, retryAfterSeconds: 12 });
  });

  it("does not attach a retry interval to unrelated HTTP failures", async () => {
    const fetchImpl = async () => new Response("not found", { status: 404 });

    try {
      await dashboardJson("https://api.example.test", "/reviews", {}, fetchImpl as typeof fetch);
      throw new Error("expected dashboardJson to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DashboardHttpError);
      expect(error).toMatchObject({ status: 404, retryAfterSeconds: undefined });
    }
  });
});
