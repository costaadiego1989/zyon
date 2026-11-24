import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { GenerateProductSeoUseCase } from "./generate-product-seo.use-case.js";
import { configureAiMetering } from "../../../../shared/ai-metering.js";

type Outcome = "reject" | "http-error" | "success" | "timeout" | "json-error";
const scenarios: Array<{ name: string; outcomes: Outcome[]; result?: string }> = [
  { name: "two rejected metered fetches", outcomes: ["reject", "reject"] },
  { name: "two HTTP failures", outcomes: ["http-error", "http-error"] },
  { name: "rejected primary and successful fallback", outcomes: ["reject", "success"], result: "seo-json" },
  { name: "deadline abort and successful fallback", outcomes: ["timeout", "success"], result: "seo-json" },
  { name: "failed JSON body and successful fallback", outcomes: ["json-error", "success"], result: "seo-json" },
];

for (const scenario of scenarios) test(`product SEO clears the exact fetch deadline for ${scenario.name}`, async () => {
  const keys = ["LOCAL_LLM_BASE_URL", "LOCAL_LLM_API_KEY", "LOCAL_LLM_MODEL", "DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
    "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { LOCAL_LLM_BASE_URL: "http://127.0.0.1:19121/v1", LOCAL_LLM_API_KEY: "synthetic-local",
    LOCAL_LLM_MODEL: "local-model", DEEPSEEK_BASE_URL: "http://127.0.0.1:19122/v1", DEEPSEEK_API_KEY: "synthetic-fallback", DEEPSEEK_MODEL: "fallback-model" });
  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  type Handle = ReturnType<typeof setTimeout>;
  const active = new Map<Handle, { delay: number | undefined; callback: () => void }>();
  const handles: Handle[] = [], delays: Array<number | undefined> = [], calls: Array<{ url: string; body: any; headers: Headers; signal: AbortSignal }> = [];
  let jsonReads = 0, firedDeadlineCallbacks = 0;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    const handle = nativeSetTimeout(callback, delay, ...args);
    handles.push(handle); delays.push(delay); active.set(handle, { delay, callback: () => callback(...args) });
    return handle;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    active.delete(handle as Handle); nativeClearTimeout(handle);
  }) as typeof clearTimeout;
  const restoreMetering = configureAiMetering({ fetch: async (context, input, init) => {
    assert.equal(context.merchantId, "merchant-seo-test"); assert.equal(context.source, "product_seo");
    assert.equal(init?.method, "POST");
    const signal = init?.signal; assert.ok(signal); assert.equal(signal.aborted, false);
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), signal });
    const outcome = scenario.outcomes[calls.length - 1]; assert.ok(outcome, "no extra provider retry");
    if (outcome === "reject") throw new Error("synthetic_metered_rejection");
    if (outcome === "timeout") {
      const timer = [...active.values()].at(-1); assert.ok(timer); assert.equal(timer.delay, 20_000);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("synthetic_fetch_aborted")), { once: true });
        // Drive the actual registered abort callback; do not change Date,
        // timer duration, ref status or production transport/deadline policy.
        queueMicrotask(() => { firedDeadlineCallbacks++; timer.callback(); });
      });
    }
    if (outcome === "http-error") return { ok: false, json: async () => { assert.fail("HTTP failure body must not be read"); } } as unknown as Response;
    return { ok: true, json: async () => {
      jsonReads++;
      assert.equal(active.size, 0, "fetch timer must be cleared BEFORE reading JSON, not after the body");
      if (outcome === "json-error") throw new Error("synthetic_json_error");
      return { choices: [{ message: { content: "  seo-json  " } }] };
    } } as Response;
  } }, () => "merchant-seo-test");
  try {
    const usecase = new GenerateProductSeoUseCase({} as never);
    const invoke = () => (usecase as any).callLlm("synthetic-prompt");
    if (scenario.result === undefined) await assert.rejects(invoke, error => error instanceof BadRequestException && error.message === "ai_generation_failed");
    else assert.equal(await invoke(), scenario.result);
    assert.equal(calls.length, 2); assert.equal(handles.length, 2);
    assert.deepEqual(delays, [20_000, 20_000]);
    assert.equal(active.size, 0, "no scheduled fetch deadline survives provider rejection/fallback");
    assert.deepEqual(calls.map(call => call.url), ["http://127.0.0.1:19121/v1/chat/completions", "http://127.0.0.1:19122/v1/chat/completions"]);
    assert.deepEqual(calls.map(call => call.body.model), ["local-model", "fallback-model"]);
    assert.deepEqual(calls.map(call => call.headers.get("authorization")), ["Bearer synthetic-local", "Bearer synthetic-fallback"]);
    for (const call of calls) {
      assert.equal(call.headers.get("content-type"), "application/json"); assert.equal(call.body.max_tokens, 500); assert.equal(call.body.temperature, 0.6);
      assert.deepEqual(call.body.messages.map((message: any) => message.role), ["system", "user"]);
      assert.equal(call.body.messages[1].content, "synthetic-prompt");
    }
    assert.equal(jsonReads, scenario.outcomes.filter(outcome => outcome === "success" || outcome === "json-error").length);
    assert.equal(firedDeadlineCallbacks, scenario.outcomes.includes("timeout") ? 1 : 0);
    assert.equal(calls[0]!.signal.aborted, scenario.outcomes.includes("timeout"));
    assert.equal(calls[1]!.signal.aborted, false);
  } finally {
    // Test cleanup also cancels real handles when the baseline intentionally
    // fails, so a regression failure does not keep the test process alive20s.
    for (const handle of handles) nativeClearTimeout(handle);
    globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout;
    restoreMetering();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
