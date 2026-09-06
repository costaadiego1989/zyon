const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Email-client compatible layout. Merchant copy is always plain text, never HTML. */
export function renderRecoveryEmail(text: string, storeName: string, rawLink?: string): string {
  let link: string | undefined;
  try {
    const url = new URL(rawLink ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) link = url.href;
  } catch { /* No active link for invalid or unsafe destinations. */ }
  const paragraphs = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const button = link ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="#202b27" style="border-radius:6px"><a href="${escape(link)}" style="display:inline-block;padding:16px 26px;color:#ffffff;font:600 16px Arial,sans-serif;text-decoration:none">Retomar minha compra</a></td></tr></table>` : "";
  let buttonPlaced = false;
  const content = paragraphs.map(part => {
    if (link && part === rawLink && !buttonPlaced) { buttonPlaced = true; return button; }
    return `<p style="margin:0 0 20px;font:16px/1.7 Arial,sans-serif;color:#39433e">${escape(part).replace(/\n/g, "<br>")}</p>`;
  }).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f4"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff"><tr><td style="padding:28px 32px;border-bottom:1px solid #e5e9e6;font:600 20px Arial,sans-serif;color:#202b27">${escape(storeName)}</td></tr><tr><td style="padding:36px 32px"><h1 style="margin:0 0 24px;font:600 28px/1.25 Arial,sans-serif;color:#202b27">Continue de onde parou.</h1>${content}${buttonPlaced ? "" : button}${link ? `<p style="margin:28px 0 0;font:12px/1.6 Arial,sans-serif;color:#59645e;overflow-wrap:anywhere">Se preferir, acesse pelo link:<br><a href="${escape(link)}" style="color:#39433e;word-break:break-all">${escape(link)}</a></p>` : ""}</td></tr></table></td></tr></table></body></html>`;
}
