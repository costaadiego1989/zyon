import { type AxiosInstance, type AxiosRequestConfig } from "axios";
export type SdkConfig = {
    apiKey: string;
    baseUrl?: string;
    environment?: "sandbox" | "production";
    timeout?: number;
    maxRetries?: number;
};
export declare class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly title: string;
    readonly detail?: string | undefined;
    readonly fields?: Record<string, string[]> | undefined;
    readonly correlationId?: string | undefined;
    constructor(status: number, code: string, title: string, detail?: string | undefined, fields?: Record<string, string[]> | undefined, correlationId?: string | undefined);
}
export declare function createAxiosInstance(config: SdkConfig): AxiosInstance;
export declare function customInstance<T>(config: AxiosRequestConfig): Promise<T>;
//# sourceMappingURL=client.d.ts.map