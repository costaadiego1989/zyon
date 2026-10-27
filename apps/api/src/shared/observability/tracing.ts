import { TracingRuntime } from "./tracing-runtime.js";
export const tracingRuntime = new TracingRuntime({
  createSdk: async config => (await import("./tracing-sdk.js")).createTracingSdk(config),
  log: event => console.log(JSON.stringify(event)),
});
export const initTracing = () => tracingRuntime.init();
export const shutdownTracing = () => tracingRuntime.shutdown();
