import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";

export type SdkConfig = {
  apiKey: string;
  baseUrl?: string;
  environment?: "sandbox" | "production";
  timeout?: number;
  maxRetries?: number;
};

const ENVIRONMENT_URLS: Record<string, string> = {
  sandbox: "https://sandbox-api.aacp.dev/v1",
  production: "https://api.aacp.dev/v1",
};

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_STATUS_CODES = [429, 502, 503, 504];
const INITIAL_BACKOFF_MS = 1000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly fields?: Record<string, string[]>,
    public readonly correlationId?: string,
  ) {
    super(`[${code}] ${title}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
  }
}

function resolveBaseUrl(config: SdkConfig): string {
  if (config.baseUrl) return config.baseUrl;
  const env = config.environment ?? "sandbox";
  return ENVIRONMENT_URLS[env] ?? ENVIRONMENT_URLS.sandbox;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAxiosInstance(config: SdkConfig): AxiosInstance {
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

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const retryCount = (error.config as any)?._retryCount ?? 0;
      const status = error.response?.status;

      if (
        status &&
        RETRY_STATUS_CODES.includes(status) &&
        retryCount < maxRetries
      ) {
        const retryAfter = parseRetryAfter(error.response);
        const backoff = retryAfter ?? INITIAL_BACKOFF_MS * 2 ** retryCount;

        const retryConfig = { ...error.config, _retryCount: retryCount + 1 };
        await sleep(backoff);
        return instance.request(retryConfig as AxiosRequestConfig);
      }

      throw unwrapError(error);
    },
  );

  return instance;
}

function parseRetryAfter(response?: AxiosResponse): number | undefined {
  const header = response?.headers?.["retry-after"];
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}

function unwrapError(error: AxiosError): ApiError | Error {
  const data = error.response?.data as any;

  if (data && typeof data === "object" && "code" in data && "title" in data) {
    return new ApiError(
      data.status ?? error.response?.status ?? 500,
      data.code,
      data.title,
      data.detail,
      data.fields,
      data.correlation_id,
    );
  }

  return error;
}

export function customInstance<T>(config: AxiosRequestConfig): Promise<T> {
  const instance = (globalThis as any).__aacp_axios_instance as
    | AxiosInstance
    | undefined;
  if (!instance) {
    throw new Error(
      "SDK not initialized. Call createClient() before making requests.",
    );
  }
  return instance.request<T>(config).then((res) => res.data);
}
