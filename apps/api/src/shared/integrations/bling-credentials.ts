import type { ErpConnection, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { encryptErpSecret, decryptErpSecret } from "../crypto/erp-secret-cipher.js";
import { blingClientChanged, blingClientFingerprint } from "./bling-token-identity.js";
import { ErpProviderError } from "./erp-provider-error.js";

export function blingTokenGrantMetadata(body: { scope?: unknown; access_token: string }) {
  const raw = body.scope; const scopeIds = Array.isArray(raw) && raw.every(value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) || Number.isSafeInteger(value) && Number(value) >= 0) ? [...new Set(raw.map(String))].sort() : null;
  return { blingClientFingerprint: blingClientFingerprint(), blingGrantedScopes: scopeIds, blingGrantSource: "authenticated_token_response", blingGrantTokenHash: createHash("sha256").update(body.access_token).digest("hex"), blingGrantReceivedAt: new Date().toISOString() };
}
/** Shared by inventory and fiscal, including the unexpired path. Never clone a rotating pair. */
export async function readBlingCredential(prisma: PrismaClient, connection: Pick<ErpConnection, "id" | "merchantId">, fetcher: typeof fetch = fetch) {
  if (!process.env.BLING_CLIENT_ID || !process.env.BLING_CLIENT_SECRET) throw new ErpProviderError("erp_bling_app_configuration_invalid", true);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${connection.id} AND merchant_id = ${connection.merchantId} AND provider = 'bling' FOR UPDATE`;
    const fresh = await tx.erpConnection.findFirst({ where: { id: connection.id, merchantId: connection.merchantId, provider: "bling" } });
    if (!fresh || fresh.status !== "connected" || !fresh.accessTokenCipher) throw new ErpProviderError("erp_bling_reauthorization_required", true);
    Object.assign(connection, fresh);
    if (blingClientChanged(fresh.config, decryptErpSecret(fresh.accessTokenCipher))) throw new ErpProviderError("erp_bling_app_changed", true);
    if (fresh.tokenExpiresAt && fresh.tokenExpiresAt.getTime() > Date.now() + 60_000) return { token: decryptErpSecret(fresh.accessTokenCipher), config: fresh.config };
    if (!fresh.refreshTokenCipher) throw new ErpProviderError("erp_bling_reauthorization_required", true);
    let response: Response; let body: Record<string, unknown>;
    try {
      response = await fetcher("https://api.bling.com.br/Api/v3/oauth/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { Authorization: "Basic " + Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded", "enable-jwt": "1" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptErpSecret(fresh.refreshTokenCipher) }).toString() });
      body = await response.json() as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    } catch { await tx.erpConnection.update({ where: { id: fresh.id }, data: { status: "error", lastErrorCode: "erp_bling_reauthorization_required" } }); return { error: "erp_bling_reauthorization_required" }; }
    const providerCode = typeof body.error === "string" ? body.error : (body.error as { type?: string } | undefined)?.type;
    if (!response.ok || typeof body.access_token !== "string" || !body.access_token || typeof body.refresh_token !== "string" || !body.refresh_token || !Number.isSafeInteger(body.expires_in) || Number(body.expires_in) <= 0) {
      const code = providerCode === "invalid_client" ? "erp_bling_app_configuration_invalid" : "erp_bling_reauthorization_required";
      await tx.erpConnection.update({ where: { id: fresh.id }, data: { status: "error", lastErrorCode: code } }); return { error: code };
    }
    const data = { accessTokenCipher: encryptErpSecret(body.access_token), refreshTokenCipher: encryptErpSecret(body.refresh_token), tokenExpiresAt: new Date(Date.now() + Number(body.expires_in) * 1000), config: { ...(fresh.config as object ?? {}), ...blingTokenGrantMetadata({ access_token: body.access_token, scope: body.scope }) } };
    await tx.erpConnection.update({ where: { id: fresh.id, merchantId: fresh.merchantId }, data }); Object.assign(connection, data); return { token: body.access_token, config: data.config };
  }, { maxWait: 30_000, timeout: 30_000 });
  if (result.error) throw new ErpProviderError(result.error, true);
  return { token: result.token!, config: result.config };
}
