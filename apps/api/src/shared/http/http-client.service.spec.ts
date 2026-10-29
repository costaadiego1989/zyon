import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpClientService, CircuitOpenError, MaxRetriesExceededError } from "./http-client.service.js";

function makeResponse(status: number, body = "{}"): Response {
  return new Response(body, { status });
}

describe("HttpClientService", () => {
  it("success — returns response on 2xx", async () => {
    const svc = new HttpClientService({ retries: 0, fetchFn: async () => makeResponse(200) });
    const res = await svc.fetch("http://example.com");
    assert.equal(res.status, 200);
  });

  it("retry-on-5xx — retries up to N times then throws MaxRetriesExceededError", async () => {
    let calls = 0;
    const svc = new HttpClientService({
      retries: 2,
      timeout: 5000,
      fetchFn: async () => { calls++; return makeResponse(503); }
    });
    await assert.rejects(
      () => svc.fetch("http://example.com"),
      MaxRetriesExceededError
    );
    assert.equal(calls, 3, "should have tried 3 times (initial + 2 retries)");
  });

  it("success on second attempt after 5xx", async () => {
    let calls = 0;
    const svc = new HttpClientService({
      retries: 2,
      timeout: 5000,
      fetchFn: async () => {
        calls++;
        return calls < 2 ? makeResponse(503) : makeResponse(200);
      }
    });
    const res = await svc.fetch("http://example.com");
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
  });

  it("circuit-open — throws CircuitOpenError after threshold failures", async () => {
    const svc = new HttpClientService({
      retries: 0,
      circuitBreakerThreshold: 2,
      fetchFn: async () => makeResponse(500)
    });
    await assert.rejects(() => svc.fetch("http://example.com"), MaxRetriesExceededError);
    await assert.rejects(() => svc.fetch("http://example.com"), MaxRetriesExceededError);
    await assert.rejects(() => svc.fetch("http://example.com"), CircuitOpenError);
  });

  it("propagates x-correlation-id header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const svc = new HttpClientService({
      retries: 0,
      fetchFn: async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return makeResponse(200);
      }
    });
    await svc.fetch("http://example.com", { correlationId: "corr-123" });
    assert.equal(capturedHeaders["x-correlation-id"], "corr-123");
  });
});
