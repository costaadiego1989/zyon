export async function crmRequest(url: string, headers: Record<string, string> = {}, method = "GET", body?: unknown,
  acceptedStatuses: number[] = []): Promise<Response> {
  try {
    const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { ...headers, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok && !acceptedStatuses.includes(response.status)) throw new Error("http_error");
    return response;
  } catch { throw new Error("inventory_crm_provider_failed"); }
}

export async function crmJson<T>(response: Response): Promise<T> {
  try {
    const data = await response.json();
    if (data?.success === false) throw new Error("provider_error");
    return data as T;
  } catch { throw new Error("inventory_crm_provider_failed"); }
}
