import assert from "node:assert/strict";
import test from "node:test";
import { authorizedNfe, cancelledNfeEvent } from "./provider-xml-evidence.js";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
const identity: FiscalIdentity = { merchantId: "a", connectionId: "c", provider: "focus", issuerTaxId: "12ABC34501DE35", environment: "homologation", reference: "original" };
const alpha = "35261112ABC34501DE35550010000000221123456780";
const numeric = "35261112345678000195550010000000221123456780";
function xml(key: string, protocol: string) { return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><tpAmb>2</tpAmb><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${identity.issuerTaxId}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>${protocol}</nProt><dhRecbto>2026-11-15T13:00:00Z</dhRecbto></infProt></protNFe></nfeProc>`; }
function event(key: string, protocol: string) { return new TextEncoder().encode(`<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>${protocol}</nProt><dhRegEvento>2026-11-15T14:00:00Z</dhRegEvento></infEvento></retEvento></procEventoNFe>`); }
test("NF-e XML authorization and cancellation accept numeric or correctly positioned alpha access keys", () => {
  for (const key of [numeric, alpha]) { assert.equal(authorizedNfe(xml(key, "1".repeat(15)), identity, key).accessKey, key); assert.equal(cancelledNfeEvent(event(key, "1".repeat(15)), identity, key).protocol, "1".repeat(15)); }
  for (const index of [0, 5, 18, 43]) { const key = numeric.slice(0, index) + "A" + numeric.slice(index + 1); assert.throws(() => authorizedNfe(xml(key, "1".repeat(15)), identity, key), /authorization/); assert.throws(() => cancelledNfeEvent(event(key, "1".repeat(15)), identity, key), /cancellation/); }
});
test("NF-e authorization and event protocols preserve15or17digits as strings and refuse14,16,18", () => {
  for (const length of [15, 17]) { const protocol = "1".repeat(length); assert.equal(authorizedNfe(xml(alpha, protocol), identity, alpha).protocol, protocol); assert.equal(cancelledNfeEvent(event(alpha, protocol), identity, alpha).protocol, protocol); }
  for (const length of [14, 16, 18]) { assert.throws(() => authorizedNfe(xml(alpha, "1".repeat(length)), identity, alpha), /authorization/); assert.throws(() => cancelledNfeEvent(event(alpha, "1".repeat(length)), identity, alpha), /cancellation/); }
});
