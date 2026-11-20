import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ReceitaManifestAdapter, RECEITA_DIRECTORY_ROOT } from "./receita-manifest.adapter.js";

const xml = (items: string[]) => `<d:multistatus xmlns:d="DAV:">${items.map(href => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>&quot;revision-1&quot;</d:getetag><d:getlastmodified>Mon, 16 Nov 2026 10:00:23 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("")}</d:multistatus>`;
test("PROS-03 AC1 discovers only observed official competences and resources with stable versioned identity", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const adapter = new ReceitaManifestAdapter(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(xml(String(url) === RECEITA_DIRECTORY_ROOT ? [RECEITA_DIRECTORY_ROOT, `${RECEITA_DIRECTORY_ROOT}2026-11/`, `${RECEITA_DIRECTORY_ROOT}2026-09/`] : [`${RECEITA_DIRECTORY_ROOT}2026-11/Empresas0.zip`, `${RECEITA_DIRECTORY_ROOT}2026-11/Cnaes.zip`, `${RECEITA_DIRECTORY_ROOT}2026-11/Socios0.zip`]), { status: 207 });
  }, () => new Date("2026-11-20T12:00:00Z"));
  assert.deepEqual(await adapter.competences(), ["2026-11", "2026-09"]);
  const manifest = await adapter.discover("2026-11");
  assert.equal(manifest.competence, "2026-11"); assert.equal(manifest.discoveredAt, "2026-11-20T12:00:00.000Z");
  assert.equal(manifest.parserVersion, "rfb-cnpj-cp1252-v1");
  assert.deepEqual(manifest.resources.map(r => ({ family: r.family, url: r.url, competence: r.competence, discoveredAt: r.discoveredAt, etag: r.etag })), ["Cnaes.zip", "Empresas0.zip"].map((name, i) => ({ family: i ? "empresas" : "cnaes", url: `${RECEITA_DIRECTORY_ROOT}2026-11/${name}`, competence: "2026-11", discoveredAt: "2026-11-20T12:00:00.000Z", etag: '"revision-1"' })));
  assert.equal((await adapter.discover("2026-11")).hash, manifest.hash);
  assert.equal(calls[0].init?.method, "PROPFIND");
  assert.equal((calls[0].init?.headers as Record<string,string>)["Depth"], "1");
  await assert.rejects(() => adapter.discover("2026-10"), /source_unavailable/);
});
test("PROS-03 AC2 rejects unauthorized resources, paths and redirects before fetching their destination", async () => {
  const calls: string[] = [];
  const adapter = new ReceitaManifestAdapter(async url => { calls.push(String(url)); return new Response(null, { status: 302, headers: { location: "https://attacker.test/dump.zip" } }); });
  await assert.rejects(() => adapter.openResource("https://attacker.test/dump.zip"), /source_not_allowed/);
  await assert.rejects(() => adapter.openResource(`${RECEITA_DIRECTORY_ROOT}2026-11/%2e%2e/private.zip`), /source_not_allowed/);
  assert.deepEqual(calls, []);
  await assert.rejects(() => adapter.openResource(`${RECEITA_DIRECTORY_ROOT}2026-11/Cnaes.zip`), /source_not_allowed/);
  assert.deepEqual(calls, [`${RECEITA_DIRECTORY_ROOT}2026-11/Cnaes.zip`]);
});
test("PROS-03 AC1 discovers months from the full official root capture including the national tar archive", async () => {
  const capture = JSON.parse(readFileSync(new URL("../../../../../tests/fixtures/rfb-root-discovery-20261120.json",import.meta.url),"utf8")) as { resources: {href:string}[] };
  const adapter = new ReceitaManifestAdapter(async () => new Response(xml(capture.resources.map(r=>r.href)), {status:207}));
  const expected = capture.resources.map(r=>/\/(\d{4}-\d{2})\/$/.exec(r.href)?.[1]).filter((v):v is string=>!!v).sort().reverse();
  assert.ok(capture.resources.some(r=>r.href.endsWith("cnpj.tar.gz")));
  assert.deepEqual(await adapter.competences(),expected);
  assert.equal(expected[0],"2026-11");
});
test("PROS-03 AC1 rejects unavailable, oversized or malformed discovery without inventing resources", async () => {
  for (const response of [new Response("denied", {status:401}), new Response("<broken>", {status:207}), new Response("x".repeat(2_097_153), {status:207})]) {
    const adapter = new ReceitaManifestAdapter(async () => response);
    await assert.rejects(() => adapter.competences(), /source_unavailable/);
  }
});
