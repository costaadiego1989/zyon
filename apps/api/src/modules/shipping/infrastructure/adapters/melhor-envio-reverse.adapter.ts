import type { MelhorEnvioTokenResolver } from "../../domain/ports/melhor-envio-token-resolver.port.js";
import type { MarketplaceShippingAccountIdentity } from "../../domain/marketplace-shipping-account-identity.js";
import { marketplaceShippingContractHash as hash } from "../../domain/marketplace-shipping-contract.js";
import { decimalCents, marketplaceShipmentProviderTime as validTime } from "../../domain/marketplace-shipment-journal.js";
import { marketplaceMelhorEnvioCartAdmitsPurchase } from "../../domain/marketplace-melhor-envio-purchase-admission.js";
import { readMelhorEnvioAccountIdentity } from "./melhor-envio-account-identity.js";
import { melhorEnvioBaseUrl, MELHOR_ENVIO_USER_AGENT } from "../melhor-envio-config.js";

export type ReversePackage = { height: number; width: number; length: number; weight: number };
export type ReverseSource = { originMerchantId: string; originalOrderId: string; accountIdentity: MarketplaceShippingAccountIdentity; insuranceCents: number;
  products: Array<{ name: string; quantity: number; unitary_value: number }> };
export type ReverseRequest = ReverseSource & {
  body: { service: 1 | 2; order_id: string; new_sender_mail: string; new_sender_phone: string;
    insurance_value: number; products: ReverseSource["products"]; package: ReversePackage; options: { own_hand: false; receipt: false } };
  from: Record<string, string>; to: Record<string, string>;
};
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const address = (value: any) => {
  const result: Record<string, string> = {};
  for (const field of ["postal_code", "address", "district", "city", "state_abbr"]) {
    if (typeof value?.[field] !== "string" || !value[field].trim()) throw Error("reverse_original_address_unproven");
    result[field] = value[field].trim();
  }
  result.postal_code = result.postal_code.replace(/\D/g, "").padStart(8, "0");
  result.location_number = String(value.location_number ?? value.number ?? "").trim();
  if (!/^\d{8}$/.test(result.postal_code) || !result.location_number) throw Error("reverse_original_address_unproven");
  return result;
};
export function validReversePackage(value: unknown): value is ReversePackage {
  const p = value as ReversePackage;
  return Boolean(p && Object.keys(p).sort().join(",") === "height,length,weight,width" &&
    [p.height, p.width, p.length, p.weight].every(v => typeof v === "number" && Number.isFinite(v) && v > 0) &&
    p.weight <= 30 && p.height >= 1 && p.width >= 8 && p.length >= 13 &&
    [p.height, p.width, p.length].every(v => Number.isInteger(v) && v <= 100) && p.height + p.width + p.length <= 200);
}

/** Native reverse carts use the original label's addresses. Each mutation is
 * called only by the durable return journal, never retried after response loss. */
export class MelhorEnvioReverseAdapter {
  constructor(private readonly tokens: MelhorEnvioTokenResolver, private readonly transport: typeof fetch = fetch) {}

  private async auth(source: ReverseSource) {
    const base = melhorEnvioBaseUrl(), expected = source.accountIdentity.environment === "test" ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    if (base !== expected || source.accountIdentity.originMerchantId !== source.originMerchantId || !uuid(source.originalOrderId)) throw Error("reverse_original_account_unavailable");
    const token = await this.tokens.resolveToken(source.originMerchantId, { allowPlatformFallback: false });
    if (!token || hash(await readMelhorEnvioAccountIdentity({ base, token, originMerchantId: source.originMerchantId }, this.transport)) !== hash(source.accountIdentity)) throw Error("reverse_original_account_unavailable");
    return { base, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "User-Agent": MELHOR_ENVIO_USER_AGENT } };
  }
  private async get(source: ReverseSource, orderId: string) {
    if (!uuid(orderId)) throw Error("reverse_order_unproven");
    const auth = await this.auth(source);
    const response = await this.transport(`${auth.base}/api/v2/me/orders/${encodeURIComponent(orderId)}`, {
      method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw Error("reverse_order_unproven");
    const row = await response.json() as Record<string, any>;
    if (row.id !== orderId) throw Error("reverse_order_unproven");
    return row;
  }
  private async post(source: ReverseSource, path: string, body: unknown) {
    const auth = await this.auth(source);
    const response = await this.transport(`${auth.base}${path}`, { method: "POST", headers: auth.headers,
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw Error("reverse_provider_response_unproven");
    return await response.json() as Record<string, any>;
  }
  async original(source: ReverseSource) {
    const row = await this.get(source, source.originalOrderId);
    if (row.reverse !== false || row.canceled_at !== null || !validTime(row.paid_at) || !validTime(row.generated_at)) throw Error("reverse_original_label_unproven");
    const volume = Array.isArray(row.volumes) && row.volumes.length === 1 ? row.volumes[0] : null;
    const p = volume ? { height: Number(volume.height), width: Number(volume.width), length: Number(volume.length), weight: Number(volume.weight) } : null;
    return { from: address(row.to), to: address(row.from), email: String(row.to?.email ?? ""), phone: String(row.to?.phone ?? ""),
      package: validReversePackage(p) ? p : null };
  }
  async prepareRequest(source: ReverseSource, input: { serviceId: 1 | 2; package: ReversePackage; email?: string; phone?: string }) {
    if (![1, 2].includes(input.serviceId) || !validReversePackage(input.package) || !Number.isSafeInteger(source.insuranceCents) || source.insuranceCents < 0 || source.insuranceCents > 2_147_483_647) throw Error("reverse_package_invalid");
    const original = await this.original(source), email = (input.email ?? original.email).trim(), phone = (input.phone ?? original.phone).replace(/\D/g, "");
    if (!Array.isArray(source.products) || !source.products.length || source.products.length > 100 ||
      source.products.some(p => !p?.name?.trim() || p.name.length > 255 || !Number.isSafeInteger(p.quantity) || p.quantity < 1 || decimalCents(p.unitary_value) === undefined) ||
      source.products.reduce((sum, p) => sum + decimalCents(p.unitary_value)! * p.quantity, 0) !== source.insuranceCents) throw Error("reverse_content_unproven");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^\d{10,13}$/.test(phone)) throw Error("reverse_buyer_contact_required");
    return { ...source, from: original.from, to: original.to, body: { service: input.serviceId, order_id: source.originalOrderId,
      new_sender_mail: email, new_sender_phone: phone, insurance_value: source.insuranceCents / 100, package: input.package,
      products: structuredClone(source.products),
      options: { own_hand: false as const, receipt: false as const } } } satisfies ReverseRequest;
  }
  async create(request: ReverseRequest) {
    const result = await this.post(request, "/api/v2/me/cart/reverse", request.body);
    if (!uuid(result.id)) throw Error("reverse_cart_id_unproven");
    return result.id;
  }
  async read(request: ReverseRequest, orderId: string, amountCents?: number) {
    const row = await this.get(request, orderId), volume = row.volumes?.length === 1 ? row.volumes[0] : null;
    if (row.reverse !== true || row.service_id !== request.body.service || hash(address(row.from)) !== hash(request.from) ||
      hash(address(row.to)) !== hash(request.to) || decimalCents(row.insurance_value) !== request.insuranceCents || !volume ||
      ["height", "width", "length", "weight"].some(k => Number(volume[k]) !== request.body.package[k as keyof ReversePackage]) ||
      row.canceled_at !== null || row.expired_at !== null || row.conciliation) throw Error("reverse_cart_binding_unproven");
    const price = decimalCents(row.price);
    const products = Array.isArray(row.products) ? row.products.map((p: any) => ({ name: p.name, quantity: Number(p.quantity), unitCents: decimalCents(p.unitary_value) })) : [];
    const expected = request.body.products.map(p => ({ name: p.name, quantity: p.quantity, unitCents: decimalCents(p.unitary_value) }));
    if (!products.length || products.length !== expected.length || hash(products.map(p => hash(p)).sort()) !== hash(expected.map(p => hash(p)).sort())) throw Error("reverse_content_unproven");
    if (price === undefined || (amountCents !== undefined && price !== amountCents)) throw Error("reverse_price_changed");
    const paid = validTime(row.paid_at) && ["released", "posted", "delivered"].includes(row.status);
    const code = paid && validTime(row.generated_at) && typeof row.authorization_code === "string" && /^\d{6,30}$/.test(row.authorization_code)
      ? row.authorization_code : null;
    return { amountCents: price, paid, code, generatedAt: code ? row.generated_at as string : null,
      purchasable: marketplaceMelhorEnvioCartAdmitsPurchase(row) };
  }
  async checkout(request: ReverseRequest, orderId: string, amountCents: number) {
    const before = await this.read(request, orderId, amountCents);
    if (!before.purchasable) throw Error("reverse_purchase_preflight_unproven");
    await this.post(request, "/api/v2/me/shipment/checkout", { orders: [orderId] });
  }
  async generate(request: ReverseRequest, orderId: string, amountCents: number) {
    if (!(await this.read(request, orderId, amountCents)).paid) throw Error("reverse_purchase_unproven");
    await this.post(request, "/api/v2/me/shipment/generate", { orders: [orderId] });
  }
  async declaration(request: ReverseRequest, orderId: string, amountCents: number) {
    if (!(await this.read(request, orderId, amountCents)).code) throw Error("reverse_generation_unproven");
    const auth = await this.auth(request);
    const response = await this.transport(`${auth.base}/api/v2/me/imprimir/dace/pdf/${encodeURIComponent(orderId)}`, {
      method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw Error("reverse_declaration_unavailable");
    const result = await response.json() as { pdf?: unknown };
    if (typeof result.pdf !== "string") throw Error("reverse_declaration_unavailable");
    const url = new URL(result.pdf);
    if (url.protocol !== "https:" || url.username || url.password) throw Error("reverse_declaration_url_invalid");
    return url.href;
  }
}
