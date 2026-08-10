import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

let sdk: NodeSDK | null = null;

export function initTracing(): void {
  if (!endpoint) {
    console.log("[OTel] Tracing disabled — set OTEL_EXPORTER_OTLP_ENDPOINT to enable.");
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || "zyon-api";

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  sdk = new NodeSDK({
    serviceName,
    spanProcessor: new BatchSpanProcessor(exporter, {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 1000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] Tracing enabled → ${endpoint} (service: ${serviceName})`);

  process.on("SIGTERM", () => sdk?.shutdown());
  process.on("SIGINT", () => sdk?.shutdown());
}
