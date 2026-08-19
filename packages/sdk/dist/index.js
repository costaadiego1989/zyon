import { createAxiosInstance } from "./client.js";
export { ApiError } from "./client.js";
export function createClient(config) {
    const instance = createAxiosInstance(config);
    globalThis.__aacp_axios_instance = instance;
    return {
        instance,
    };
}
//# sourceMappingURL=index.js.map