import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import type { CompanyManifest, CompanySourceResource } from "@zyon/shared-types";

export const RECEITA_DIRECTORY_ROOT = "https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9/";
const root = new URL(RECEITA_DIRECTORY_ROOT);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const family = (name: string) => /^(Empresas|Estabelecimentos|Simples)\d*\.zip$/i.exec(name)?.[1].toLowerCase() ?? ({ "cnaes.zip": "cnaes", "municipios.zip": "municipios", "naturezas.zip": "naturezas" } as Record<string, string>)[name.toLowerCase()];

export class ReceitaManifestAdapter {
  constructor(private readonly request: typeof fetch = fetch, private readonly now = () => new Date()) {}

  private allowed(value: string, listing = false): URL {
    let url: URL;
    try {
      if (/%2e|%2f|%5c|\\|(?:^|\/)\.\.(?:\/|$)/i.test(value)) throw new Error();
      url = new URL(value, root);
      if (url.origin !== root.origin || url.username || url.password || url.hash || url.search || !url.pathname.startsWith(root.pathname)) throw new Error();
      const relative = url.pathname.slice(root.pathname.length);
      if (!(listing ? /^(?:\d{4}-(?:0[1-9]|1[0-2])\/)?$/ : /^\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9]+\.zip$/).test(relative)) throw new Error();
    } catch { throw new Error("source_not_allowed"); }
    return url;
  }
  private async response(value: string, listing: boolean): Promise<Response> {
    let url = this.allowed(value, listing);
    for (let hop = 0; hop <= 3; hop++) {
      let response: Response;
      try {
        response = await this.request(url.href, { method: listing ? "PROPFIND" : "GET", redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "X-Requested-With": "XMLHttpRequest", "Authorization": `Basic ${Buffer.from("YggdBLfdninEJX9:").toString("base64")}`, ...(listing ? { "Depth": "1", "Content-Type": "application/xml" } : {}) }, ...(listing ? { body: '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>' } : {}) });
      } catch (cause) { throw new Error("source_unavailable", { cause }); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("source_unavailable");
        url = this.allowed(new URL(location, url).href, listing); continue;
      }
      if (!(listing ? response.status === 207 : response.ok)) { await response.body?.cancel(); throw new Error("source_unavailable"); }
      return response;
    }
    throw new Error("source_unavailable:redirect_limit");
  }
  openResource(url: string) { return this.response(url, false); }
  private async list(url: string) {
    const response = await this.response(url, true);
    const entries: Record<string, string>[] = [];
    let current: Record<string, string> | null = null; let field = ""; let bytes = 0;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("doctype", () => { throw new Error("source_unavailable:xml_doctype"); });
    parser.on("opentag", tag => { field = tag.uri === "DAV:" ? tag.local : ""; if (field === "response") current = {}; });
    parser.on("text", text => { if (current && ["href", "getetag", "getlastmodified", "status"].includes(field)) current[field] = (current[field] ?? "") + text; });
    parser.on("closetag", tag => { if (tag.uri === "DAV:" && tag.local === "response" && current) { entries.push(current); current = null; } field = ""; });
    try {
      if (!response.body) throw new Error();
      const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 2_097_152) throw new Error(); parser.write(decoder.decode(chunk.value, { stream: true })); } parser.write(decoder.decode()).close(); }
      finally { await reader.cancel(); }
    } catch (cause) { throw new Error("source_unavailable:invalid_manifest", { cause }); }
    return entries.filter(entry => /\s200\s/.test(entry.status ?? ""));
  }
  async competences(): Promise<string[]> {
    const entries = await this.list(RECEITA_DIRECTORY_ROOT); const result = new Set<string>();
    for (const entry of entries) { const url = this.allowed(entry.href, true); const month = url.pathname.slice(root.pathname.length).replace(/\/$/, ""); if (month) result.add(month); }
    return [...result].sort().reverse();
  }
  async discover(competence: string): Promise<CompanyManifest> {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(competence)) throw new Error("source_not_allowed");
    if (!(await this.competences()).includes(competence)) throw new Error("source_unavailable:competence");
    const discoveredAt = this.now().toISOString(); const resources: CompanySourceResource[] = [];
    const monthUrl = `${RECEITA_DIRECTORY_ROOT}${competence}/`;
    for (const entry of await this.list(monthUrl)) {
      const candidate = new URL(entry.href, monthUrl);
      if (candidate.href === monthUrl) continue;
      const url = this.allowed(entry.href); const name = url.pathname.split("/").at(-1)!; const kind = family(name);
      if (url.pathname.slice(root.pathname.length).split("/")[0] !== competence) throw new Error("source_not_allowed");
      if (kind) resources.push({ id: sha(url.href), family: kind, url: url.href, competence, discoveredAt, etag: entry.getetag ?? null, lastModified: entry.getlastmodified ?? null });
    }
    resources.sort((a, b) => a.url.localeCompare(b.url));
    if (!resources.length) throw new Error("source_unavailable:empty_manifest");
    const parserVersion = "rfb-cnpj-cp1252-v1";
    const hash = sha(JSON.stringify({ competence, parserVersion, resources: resources.map(({ discoveredAt: _date, ...resource }) => resource) }));
    return { id: hash, hash, competence, parserVersion, resources, discoveredAt };
  }
}
