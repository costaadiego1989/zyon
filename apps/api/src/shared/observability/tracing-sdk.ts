import type { TracingConfig } from "./tracing-config.js";
import type { TracingSdkHandle } from "./tracing-runtime.js";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { SafeSpanExporter } from "./safe-span-exporter.js";

/** Loaded after dotenv/config validation. Tests may supply an in-memory exporter. */
export async function createTracingSdk(config: TracingConfig, testExporter?: SpanExporter): Promise<TracingSdkHandle> {
  const [{ NodeSDK }, base] = await Promise.all([import("@opentelemetry/sdk-node"), import("@opentelemetry/sdk-trace-base")]);
  const exporter = testExporter ?? new (await import("@opentelemetry/exporter-trace-otlp-http")).OTLPTraceExporter({ url: config.endpoint, timeoutMillis: 2000 });
  const processor = new base.BatchSpanProcessor(new SafeSpanExporter(exporter, config.serviceName), {
    maxQueueSize: 1024, maxExportBatchSize: 128, scheduledDelayMillis: 1000, exportTimeoutMillis: 2000,
  });
  const ratio = new base.TraceIdRatioBasedSampler(config.sampleRatio);
  const root = config.sampler.endsWith("always_on") ? new base.AlwaysOnSampler() : config.sampler.endsWith("always_off") ? new base.AlwaysOffSampler() : ratio;
  const sampler = config.sampler.startsWith("parentbased_") ? new base.ParentBasedSampler({ root }) : root;
  const instrumentations = config.autoInstrumentation
    ? [(await import("@opentelemetry/auto-instrumentations-node")).getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false }, "@opentelemetry/instrumentation-dns": { enabled: false }, "@opentelemetry/instrumentation-net": { enabled: false },
    })] : [];
  const sdk = new NodeSDK({ serviceName: config.serviceName, spanProcessors: [processor], sampler, instrumentations,
    autoDetectResources: false, resourceDetectors: [], logRecordProcessors: [], metricReaders: [],
    spanLimits: { attributeCountLimit: 24, attributeValueLengthLimit: 256, eventCountLimit: 8, attributePerEventCountLimit: 8, linkCountLimit: 0 },
  });
  return { start: () => sdk.start(), forceFlush: () => processor.forceFlush(), shutdown: () => sdk.shutdown() };
}

