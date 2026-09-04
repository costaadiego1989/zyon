import axios from "axios";
const ENVIRONMENT_URLS = {
    sandbox: "https://sandbox-api.aacp.dev/v1",
    production: "https://api.aacp.dev/v1",
};
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_STATUS_CODES = [429, 502, 503, 504];
const INITIAL_BACKOFF_MS = 1000;
export class ApiError extends Error {
    status;
    code;
    title;
    detail;
    fields;
    correlationId;
    constructor(status, code, title, detail, fields, correlationId) {
        super(`[${code}] ${title}${detail ? `: ${detail}` : ""}`);
        this.status = status;
        this.code = code;
        this.title = title;
        this.detail = detail;
        this.fields = fields;
        this.correlationId = correlationId;
        this.name = "ApiError";
    }
}
function resolveBaseUrl(config) {
    if (config.baseUrl)
        return config.baseUrl;
    const env = config.environment ?? "sandbox";
    return ENVIRONMENT_URLS[env] ?? ENVIRONMENT_URLS.sandbox;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function createAxiosInstance(config) {
    const instance = axios.create({
        baseURL: resolveBaseUrl(config),
        timeout: config.timeout ?? DEFAULT_TIMEOUT,
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
    });
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    instance.interceptors.response.use((response) => response, async (error) => {
        const retryCount = error.config?._retryCount ?? 0;
        const status = error.response?.status;
        if (status &&
            RETRY_STATUS_CODES.includes(status) &&
            retryCount < maxRetries) {
            const retryAfter = parseRetryAfter(error.response);
            const backoff = retryAfter ?? INITIAL_BACKOFF_MS * 2 ** retryCount;
            const retryConfig = { ...error.config, _retryCount: retryCount + 1 };
            await sleep(backoff);
            return instance.request(retryConfig);
        }
        throw unwrapError(error);
    });
    return instance;
}
function parseRetryAfter(response) {
    const header = response?.headers?.["retry-after"];
    if (!header)
        return undefined;
    const seconds = Number(header);
    if (!Number.isNaN(seconds) && seconds > 0)
        return seconds * 1000;
    return undefined;
}
function unwrapError(error) {
    const data = error.response?.data;
    if (data && typeof data === "object" && "code" in data && "title" in data) {
        return new ApiError(data.status ?? error.response?.status ?? 500, data.code, data.title, data.detail, data.fields, data.correlation_id);
    }
    return error;
}
export function customInstance(config) {
    const instance = globalThis.__aacp_axios_instance;
    if (!instance) {
        throw new Error("SDK not initialized. Call createClient() before making requests.");
    }
    return instance.request(config).then((res) => res.data);
}
//# sourceMappingURL=client.js.map