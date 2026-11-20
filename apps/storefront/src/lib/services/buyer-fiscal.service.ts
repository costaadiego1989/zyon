import { API_BASE, getToken } from "./http";
import { getValidBuyer } from "../buyer-auth";
import { fetchPurchases } from "./buyer-hub.service";
export interface BuyerFiscalNote {
  intentId: string;
  sellerMerchantId: string;
  orderId: string;
  state: string;
  documentState: "available" | "document_pending";
  number?: string;
  series?: string;
  accessKey?: string;
  authorizationProtocol?: string;
  authorizedAt?: string;
  cancellationProtocol?: string;
  documents: Array<{ kind: "xml" | "danfe"; available: boolean }>;
}
export class BuyerFiscalError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Faça login para consultar sua nota fiscal."
        : status === 403 || status === 404
        ? "Acesso negado. Este pedido não está disponível nesta conta."
        : status === 409
        ? "Arquivo fiscal em recuperação. Tente novamente."
        : "Não foi possível consultar a nota fiscal. Tente novamente."
    );
  }
}
function path(merchantId: string, orderId: string) {
  return `${API_BASE}/buyer/me/orders/${encodeURIComponent(
    merchantId
  )}/${encodeURIComponent(orderId)}/fiscal`;
}
async function request(url: string, signal?: AbortSignal) {
  const token = getToken();
  if (!token) throw new BuyerFiscalError(401);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new BuyerFiscalError(response.status);
  return response;
}
export async function fetchBuyerFiscalNotes(
  merchantId: string,
  orderId: string,
  environment: string,
  signal?: AbortSignal
) {
  const response = await request(
    path(merchantId, orderId) + "?" + new URLSearchParams({ environment }),
    signal
  );
  const body = (await response.json()) as { items: BuyerFiscalNote[] };
  if (!Array.isArray(body.items)) throw new BuyerFiscalError(503);
  return body.items;
}
export async function fetchBuyerFiscalDocument(
  merchantId: string,
  orderId: string,
  intentId: string,
  environment: string,
  kind: "xml" | "danfe",
  signal?: AbortSignal
) {
  const response = await request(
    path(merchantId, orderId) +
      `/${encodeURIComponent(intentId)}/documents/${kind}?` +
      new URLSearchParams({ environment }),
    signal
  );
  const type = response.headers.get("content-type")?.split(";")[0];
  if (
    kind === "xml"
      ? !["application/xml", "text/xml"].includes(type ?? "")
      : type !== "application/pdf"
  )
    throw new BuyerFiscalError(503);
  const blob = await response.blob();
  if (!blob.size) throw new BuyerFiscalError(503);
  return {
    blob,
    fileName: kind === "xml" ? "nota-fiscal.xml" : "nota-fiscal.pdf",
  };
}
/** Existing authorized purchase pagination, scoped to the original commercial host. URL input grants no access. */
export async function findOwnedFiscalPurchase(
  merchantId: string,
  orderId: string,
  signal: AbortSignal
) {
  const token = getValidBuyer()?.token;
  if (!token) throw new BuyerFiscalError(401);
  let cursor = "";
  const seen = new Set<string>();
  do {
    if (signal.aborted || getValidBuyer()?.token !== token)
      throw new DOMException("Identity changed", "AbortError");
    const page = await fetchPurchases(cursor, 100, merchantId, signal);
    if (signal.aborted || getValidBuyer()?.token !== token)
      throw new DOMException("Identity changed", "AbortError");
    const owned = page.items.find(
      (p) => p.order_id === orderId && p.merchant_id === merchantId
    );
    if (owned) return owned;
    const next = page.next_cursor;
    if (!next) return null;
    if (seen.has(next)) throw new BuyerFiscalError(503);
    seen.add(next);
    cursor = next;
  } while (cursor);
  return null;
}
