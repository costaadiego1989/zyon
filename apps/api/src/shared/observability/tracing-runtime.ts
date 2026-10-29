import { resolveTracingConfig, type TracingConfig } from "./tracing-config.js";
export interface TracingSdkHandle { start(): void | Promise<void>; forceFlush(): Promise<void>; shutdown(): Promise<void> }
export type TracingStatus = "disabled" | "running" | "failed" | "stopped";
export interface TracingLog { event: "tracing.lifecycle"; reason: "not_configured" | "sdk_disabled" | "exporter_disabled" | "invalid_config" | "started" | "start_failed" | "flush_failed" | "shutdown_failed" | "shutdown_wait_failed" }

/** One SDK per runtime. Telemetry failure never retries or stops commerce startup. */
export class TracingRuntime {
  private sdk?: TracingSdkHandle;
  private initializing?: Promise<{ status: TracingStatus }>;
  private closing?: Promise<void>;
  private disposing?: Promise<void>;
  private stopped = false;
  constructor(private readonly options: { createSdk: (config: TracingConfig) => Promise<TracingSdkHandle>;
    log?: (event: TracingLog) => void; lifecycleTimeoutMs?: number }) {}

  init(env: NodeJS.ProcessEnv = process.env): Promise<{ status: TracingStatus }> {
    if (this.stopped) return Promise.resolve({ status: "stopped" });
    if (this.initializing) return this.initializing;
    const resolved = resolveTracingConfig(env);
    if (resolved.status === "disabled") { this.log(resolved.reason); return Promise.resolve({ status: "disabled" }); }
    this.initializing = this.start(resolved.config);
    return this.initializing;
  }
  private async start(config: TracingConfig): Promise<{ status: TracingStatus }> {
    try {
      this.sdk = await this.options.createSdk(config);
      if (this.stopped) { await this.dispose(); return { status: "stopped" }; }
      await this.sdk.start();
      if (this.stopped) { await this.dispose(); return { status: "stopped" }; }
      this.log("started"); return { status: "running" };
    } catch { this.log("start_failed"); if (this.sdk) await this.dispose(); return { status: "failed" }; }
  }
  shutdown(): Promise<void> { this.stopped = true; return this.closing ??= this.close(); }
  private async close(): Promise<void> {
    if (this.initializing) await this.bounded(() => this.initializing!, "shutdown_wait_failed");
    if (this.sdk) await this.dispose();
  }
  private dispose(): Promise<void> {
    return this.disposing ??= (async () => {
      await this.bounded(() => this.sdk!.forceFlush(), "flush_failed");
      await this.bounded(() => this.sdk!.shutdown(), "shutdown_failed");
    })();
  }
  private async bounded(action: () => Promise<unknown>, reason: TracingLog["reason"]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("tracing_timeout")), this.options.lifecycleTimeoutMs ?? 2500);
      })]);
    } catch { this.log(reason); } finally { if (timer) clearTimeout(timer); }
  }
  private log(reason: TracingLog["reason"]): void { try { this.options.log?.({ event: "tracing.lifecycle", reason }); } catch { /* Non-fatal. */ } }
}

