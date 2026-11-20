import type { CompanyManifest } from "@zyon/shared-types";
/** Parser v1 binds the observed national ten-part layout; unknown layouts fail closed. */
export function assertCompleteDirectoryManifest(manifest: CompanyManifest): void {
  if(manifest.parserVersion!=="rfb-cnpj-cp1252-v1")throw new Error("parser_version_unsupported");
  const expected=[...Array.from({length:10},(_,i)=>`empresas:Empresas${i}.zip`),...Array.from({length:10},(_,i)=>`estabelecimentos:Estabelecimentos${i}.zip`),"simples:Simples.zip","cnaes:Cnaes.zip","municipios:Municipios.zip","naturezas:Naturezas.zip"].sort();
  const actual=manifest.resources.map(r=>`${r.family}:${new URL(r.url).pathname.split("/").at(-1)}`).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)||manifest.resources.some(r=>r.competence!==manifest.competence))throw new Error("manifest_incomplete");
}
