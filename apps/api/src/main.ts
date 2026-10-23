import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startInstrumentedApplication } from "./shared/observability/bootstrap-sequence.js";

const directory = dirname(fileURLToPath(import.meta.url));
void startInstrumentedApplication({
  loadEnvironment: () => {
    loadDotenv({ path: resolve(directory, "../.env"), override: false });
    loadDotenv({ path: resolve(directory, "../../../.env"), override: false });
  },
  initTracing: async () => (await import("./shared/observability/tracing.js")).initTracing(),
  loadApplication: async () => (await import("./application-bootstrap.js")).bootstrap(),
  shutdownTracing: async () => (await import("./shared/observability/tracing.js")).shutdownTracing(),
});
