import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "aacp-api",
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT && {
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }))],
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
