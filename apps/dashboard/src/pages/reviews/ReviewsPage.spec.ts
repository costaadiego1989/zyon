import { describe, expect, it } from "vitest";
import { DashboardHttpError } from "../../api/http/error.js";
import { reviewLoadError } from "./ReviewsPage.js";

describe("reviewLoadError", () => {
  it("turns a 429 response into an actionable message without exposing the HTTP identifier", () => {
    const result = reviewLoadError(new DashboardHttpError(429, "rate_limit_exceeded", 15));

    expect(result.title).toBe("Muitas atualizações em sequência");
    expect(result.description).toContain("15 segundos");
    expect(result.description).not.toContain("dashboard_http_429");
    expect(result.retryAfterSeconds).toBe(15);
  });

  it("gives a connection failure a clear recovery action", () => {
    expect(reviewLoadError(new DashboardHttpError(0, "network_error"))).toMatchObject({
      title: "Não foi possível conectar ao servidor",
      description: expect.stringContaining("conexão"),
    });
  });
});
