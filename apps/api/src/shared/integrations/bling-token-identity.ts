import { createHash } from "node:crypto";

export function blingClientFingerprint(): string {
  return createHash("sha256").update(process.env.BLING_CLIENT_ID?.trim() ?? "").digest("hex");
}

/** Only detects an obsolete client binding. JWT decoding never authorizes a request. */
export function blingClientChanged(config: unknown, accessToken: string): boolean {
  const stored = config && typeof config === "object" ? (config as Record<string, unknown>).blingClientFingerprint : undefined;
  if (typeof stored === "string") return stored !== blingClientFingerprint();
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.aud === "string" && /^[a-zA-Z0-9]{40}$/.test(claims.aud) && claims.aud !== process.env.BLING_CLIENT_ID?.trim();
  } catch { return false; }
}
