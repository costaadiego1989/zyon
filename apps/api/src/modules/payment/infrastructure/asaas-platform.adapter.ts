import type {
  AsaasPlatformPort,
} from "../domain/ports/payment-platform-provider.port.js";
import type {
  AsaasSubaccountInput,
} from "../domain/payment-platform.types.js";

export class AsaasPlatformAdapter implements AsaasPlatformPort {
  constructor(
    private readonly baseUrl: string,
    private readonly rootApiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async createSubaccount(
    input: AsaasSubaccountInput,
  ): Promise<{
    accountId: string;
    walletId: string;
    apiKey: string;
  }> {
    const response = await this.request<{
      id?: string;
      walletId?: string;
      apiKey?: string;
    }>("/v3/accounts", this.rootApiKey, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.id || !response.walletId || !response.apiKey) {
      throw new Error("asaas_subaccount_credentials_missing");
    }
    return {
      accountId: response.id,
      walletId: response.walletId,
      apiKey: response.apiKey,
    };
  }

  retrieveAccountStatus(apiKey: string) {
    return this.request<{
      general: string;
      commercialInfo: string;
      bankAccountInfo: string;
      documentation: string;
    }>("/v3/myAccount/status", apiKey, { method: "GET" });
  }

  async listOnboardingLinks(apiKey: string): Promise<string[]> {
    const response = await this.request<{
      data?: Array<{ onboardingUrl?: string | null }>;
    }>("/v3/myAccount/documents", apiKey, { method: "GET" });
    return (response.data ?? [])
      .map((document) => document.onboardingUrl?.trim())
      .filter((url): url is string => Boolean(url));
  }

  async findSubaccountByCpfCnpj(cpfCnpj: string): Promise<{ accountId: string } | null> {
    const digits = cpfCnpj.replace(/\D+/g, "");
    if (!digits) return null;
    const response = await this.request<{
      data?: Array<{ id?: string }>;
    }>(`/v3/accounts?cpfCnpj=${encodeURIComponent(digits)}&limit=1`, this.rootApiKey, { method: "GET" });
    const id = response.data?.[0]?.id;
    return id ? { accountId: id } : null;
  }

  async createSubaccountApiKey(accountId: string): Promise<{ apiKey: string }> {
    // apiKey is only returned once at creation; for an existing subaccount we
    // mint a fresh access token to be able to operate on its behalf.
    const response = await this.request<{ apiKey?: string; access_token?: string }>(
      `/v3/accounts/${encodeURIComponent(accountId)}/accessTokens`,
      this.rootApiKey,
      { method: "POST", body: JSON.stringify({ name: "zyon-integration" }) },
    );
    const apiKey = response.apiKey ?? response.access_token;
    if (!apiKey) throw new Error("asaas_subaccount_api_key_missing");
    return { apiKey };
  }

  async retrieveWalletId(apiKey: string): Promise<string | null> {
    // GET /v3/wallets with the subaccount's own apiKey returns its wallet(s).
    const response = await this.request<{
      data?: Array<{ id?: string; walletId?: string }>;
    }>("/v3/wallets/", apiKey, { method: "GET" });
    const w = response.data?.[0];
    return w?.walletId ?? w?.id ?? null;
  }

  private async request<T>(
    path: string,
    apiKey: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/+$/, "")}${path}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          access_token: apiKey,
          ...init.headers,
        },
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `asaas_platform_request_failed_${response.status}:${detail}`,
      );
    }
    return (await response.json()) as T;
  }
}
