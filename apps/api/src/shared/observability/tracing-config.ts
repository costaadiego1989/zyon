import { z } from "zod";
const configSchema = z.strictObject({
  endpoint: z.string().url().max(2048), serviceName: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/),
  sampler: z.enum(["parentbased_traceidratio", "traceidratio", "always_on", "always_off", "parentbased_always_on", "parentbased_always_off"]),
  sampleRatio: z.number().finite().min(0).max(1), autoInstrumentation: z.boolean(),
});
export type TracingConfig = z.infer<typeof configSchema>;
export type TracingConfigResult = { status: "enabled"; config: TracingConfig } | { status: "disabled"; reason: "not_configured" | "sdk_disabled" | "exporter_disabled" | "invalid_config" };

/** Configuration is read at init, never captured at module import. */
export function resolveTracingConfig(env: NodeJS.ProcessEnv): TracingConfigResult {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return { status: "disabled", reason: "sdk_disabled" };
  const exporter = env.OTEL_TRACES_EXPORTER?.trim();
  if (exporter === "none") return { status: "disabled", reason: "exporter_disabled" };
  if (exporter && exporter !== "otlp") return { status: "disabled", reason: "invalid_config" };
  const explicit = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim(), generic = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!explicit && !generic) return { status: "disabled", reason: "not_configured" };
  try {
    const url = new URL(explicit || generic!);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid");
    if (!explicit) { const path = url.pathname.replace(/\/+$/, ""); url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`; }
    const arg = env.OTEL_TRACES_SAMPLER_ARG;
    if (arg !== undefined && !/^\d+(?:\.\d+)?$/.test(arg.trim())) throw new Error("invalid");
    const parsed = configSchema.safeParse({ endpoint: url.href, serviceName: env.OTEL_SERVICE_NAME?.trim() || "zyon-api",
      sampler: env.OTEL_TRACES_SAMPLER?.trim() || "parentbased_traceidratio", sampleRatio: arg === undefined ? 0.1 : Number(arg.trim()),
      autoInstrumentation: env.OTEL_AUTO_INSTRUMENTATION === "enabled" });
    return parsed.success ? { status: "enabled", config: parsed.data } : { status: "disabled", reason: "invalid_config" };
  } catch { return { status: "disabled", reason: "invalid_config" }; }
}

