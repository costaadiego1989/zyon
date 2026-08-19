import { type SdkConfig, createAxiosInstance } from "./client.js";

export { ApiError } from "./client.js";
export type { SdkConfig } from "./client.js";

export function createClient(config: SdkConfig) {
  const instance = createAxiosInstance(config);
  (globalThis as any).__aacp_axios_instance = instance;

  return {
    instance,
  };
}
