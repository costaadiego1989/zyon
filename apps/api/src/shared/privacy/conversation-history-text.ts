const REDACTED = "[redigido]";

/** Only recognizable credentials/binary payloads are removed; public commerce text stays text. */
export function conversationHistoryText(text: string, limit: number): string {
  // Cap work before regex/URL parsing. A truncated recognizable secret still
  // gets removed; an arbitrarily large provider string cannot expand this work.
  const truncated = text.length > limit;
  let clean = text
    .slice(0, limit)
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g,
      REDACTED
    )
    .replace(/\b(?:data|blob):[^\s"'<>]+/gi, REDACTED)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (urlText) => {
      try {
        const url = new URL(urlText);
        const secretKey =
          /^(?:token|access_token|refresh_token|conversation_token|client_secret|api_key|apikey|signature|sig|x-amz-signature|x-goog-signature|x-amz-credential|x-amz-security-token|x-goog-credential)$/i;
        const financialHandoff =
          url.hostname === "checkout.stripe.com" ||
          (/(?:^|\.)mercadopago\.com(?:\.[a-z]{2})?$/i.test(url.hostname) &&
            /^\/checkout(?:\/|$)/i.test(url.pathname)) ||
          (/(?:^|\.)asaas\.com$/i.test(url.hostname) &&
            /^\/i\//i.test(url.pathname));
        return financialHandoff ||
          url.username ||
          url.password ||
          [...url.searchParams.keys()].some((key) => secretKey.test(key)) ||
          /(?:^#|[&])(?:token|access_token|client_secret)=/i.test(url.hash)
          ? REDACTED
          : urlText;
      } catch {
        return urlText;
      }
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b(?:[sr]k_(?:live|test)_[A-Za-z0-9]+|sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}|APP_USR-[A-Za-z0-9-]{16,})\b/g,
      REDACTED
    )
    .replace(/\$aact_(?:prod|hmlg)_[A-Za-z0-9_$-]+/g, REDACTED)
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|conversation[_-]?token|password|senha|secret|client[_-]?secret)\s*["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;<>]+)/gi,
      `$1${REDACTED}`
    )
    .replace(
      /((?:otp|c[oó]digo\s+de\s+(?:verifica[cç][aã]o|autentica[cç][aã]o)|verification[_ ]code)\s*[:=]\s*)\d{4,8}\b/gi,
      `$1${REDACTED}`
    )
    .replace(/\b[A-Za-z0-9+/]{200,}={0,2}/g, REDACTED)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (truncated || clean.length > limit)
    clean = clean.slice(0, limit - 1).replace(/[\ud800-\udbff]$/, "") + "…";
  return clean;
}
