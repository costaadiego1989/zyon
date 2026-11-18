import { gunzipSync } from "node:zlib";
import { SaxesParser } from "saxes";
import { isFiscalAccessKey } from "../../domain/fiscal-access-key.js";
import { isFiscalProtocol } from "../../domain/fiscal-protocol.js";
import type { FiscalAuthorization, FiscalCancellation, FiscalIdentity } from "../../domain/fiscal-provider.js";
const NFE_NAMESPACE = "http://www.portalfiscal.inf.br/nfe";
interface XmlNode { name: string; namespace: string; attributes: Record<string, string>; children: XmlNode[]; text: string }
function parseXml(xml: string): XmlNode {
  if (!xml || Buffer.byteLength(xml, "utf8") > 20 * 1024 * 1024) throw new Error("fiscal_xml_evidence_invalid");
  const parser = new SaxesParser({ xmlns: true }); const stack: XmlNode[] = []; let root: XmlNode | undefined; let count = 0;
  parser.on("error", () => { throw new Error("fiscal_xml_evidence_invalid"); });
  parser.on("doctype", () => { throw new Error("fiscal_xml_evidence_invalid"); });
  parser.on("opentag", tag => {
    if (++count > 100000 || stack.length >= 64) throw new Error("fiscal_xml_evidence_invalid");
    const node: XmlNode = { name: tag.local, namespace: tag.uri, attributes: Object.fromEntries(Object.values(tag.attributes)
      .filter(attribute => attribute.uri === "").map(attribute => [attribute.local, attribute.value])), children: [], text: "" };
    if (stack.length) stack[stack.length - 1]!.children.push(node); else { if (root) throw new Error("fiscal_xml_evidence_invalid"); root = node; } stack.push(node);
  });
  const text = (value: string) => { if (stack.length) stack[stack.length - 1]!.text += value; };
  parser.on("text", text); parser.on("cdata", text); parser.on("closetag", () => { stack.pop(); });
  try { parser.write(xml).close(); } catch { throw new Error("fiscal_xml_evidence_invalid"); }
  if (!root || stack.length) throw new Error("fiscal_xml_evidence_invalid"); return root;
}
function child(parent: XmlNode, name: string): XmlNode {
  const values = parent.children.filter(node => node.name === name && node.namespace === NFE_NAMESPACE);
  if (values.length !== 1) throw new Error("fiscal_xml_evidence_invalid"); return values[0]!;
}
function scalar(parent: XmlNode, name: string) { const node = child(parent, name); if (node.children.length) throw new Error("fiscal_xml_evidence_invalid"); return node.text.trim(); }
export function safeXml(bytes: Uint8Array) {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseXml(xml);
  return xml;
}
export function decodeBlingDocument(data: Record<string, unknown>, kind: "xml" | "danfe") {
  if (!Array.isArray(data.data) || data.data.length !== 1) throw new Error("fiscal_artifact_response_invalid");
  const content = data.data[0]?.conteudo;
  if (typeof content !== "string" || content.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw new Error("fiscal_artifact_response_invalid");
  let bytes: Uint8Array;
  try { bytes = gunzipSync(Buffer.from(content, "base64"), { maxOutputLength: 20 * 1024 * 1024 }); } catch { throw new Error("fiscal_artifact_response_invalid"); }
  if (kind === "xml") safeXml(bytes);
  else if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("fiscal_artifact_response_invalid");
  return { bytes, mimeType: kind === "xml" ? "application/xml" : "application/pdf" };
}
export function authorizedNfe(xml: string, identity: FiscalIdentity, expectedKey?: string): FiscalAuthorization {
  const root = parseXml(xml);
  if (root.name !== "nfeProc" || root.namespace !== NFE_NAMESPACE) throw new Error("fiscal_xml_evidence_invalid");
  const invoice = child(child(root, "NFe"), "infNFe"); const ide = child(invoice, "ide"); const emit = child(invoice, "emit"); const protocol = child(child(root, "protNFe"), "infProt");
  const key = scalar(protocol, "chNFe");
  if (scalar(emit, identity.issuerTaxId.length === 11 ? "CPF" : "CNPJ") !== identity.issuerTaxId) throw new Error("fiscal_identity_mismatch");
  const environment = identity.environment === "production" ? "1" : "2";
  if (scalar(protocol, "tpAmb") !== environment || scalar(ide, "tpAmb") !== environment) throw new Error("fiscal_environment_mismatch");
  if (!isFiscalAccessKey(key) || key.slice(20, 22) !== "55" || scalar(ide, "mod") !== "55" || invoice.attributes.Id !== "NFe" + key || expectedKey && key !== expectedKey
    || !["100", "150"].includes(scalar(protocol, "cStat")) || !/^\d{1,9}$/.test(scalar(ide, "nNF")) || !/^\d{1,3}$/.test(scalar(ide, "serie"))
    || !isFiscalProtocol(scalar(protocol, "nProt")) || !Number.isFinite(Date.parse(scalar(protocol, "dhRecbto")))) throw new Error("fiscal_authorization_evidence_invalid");
  return { number: scalar(ide, "nNF"), series: scalar(ide, "serie"), accessKey: key, protocol: scalar(protocol, "nProt"), authorizedAt: scalar(protocol, "dhRecbto") };
}
export function cancelledNfeEvent(bytes: Uint8Array, identity: FiscalIdentity, expectedKey: string): FiscalCancellation {
  const root = parseXml(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (root.namespace !== NFE_NAMESPACE || !["procEventoNFe", "retEvento"].includes(root.name)) throw new Error("fiscal_cancellation_evidence_invalid");
  const event = child(root.name === "retEvento" ? root : child(root, "retEvento"), "infEvento");
  if (!isFiscalAccessKey(expectedKey) || expectedKey.slice(20, 22) !== "55" || scalar(event, "chNFe") !== expectedKey || scalar(event, "tpEvento") !== "110111"
    || scalar(event, "tpAmb") !== (identity.environment === "production" ? "1" : "2") || !["135", "155"].includes(scalar(event, "cStat"))
    || !isFiscalProtocol(scalar(event, "nProt")) || !Number.isFinite(Date.parse(scalar(event, "dhRegEvento")))) throw new Error("fiscal_cancellation_evidence_invalid");
  return { protocol: scalar(event, "nProt"), cancelledAt: scalar(event, "dhRegEvento") };
}

/** Private copies require coherent access-key components in addition to the provider query evidence. */
export function authorizedNfeWithKeyComponents(xml: string, identity: FiscalIdentity, expectedKey: string): FiscalAuthorization {
  const authorization = authorizedNfe(xml, identity, expectedKey);
  if (authorization.accessKey.slice(6, 20) !== identity.issuerTaxId.padStart(14, "0") || authorization.accessKey.slice(20, 22) !== "55"
    || authorization.accessKey.slice(22, 25) !== authorization.series.padStart(3, "0") || authorization.accessKey.slice(25, 34) !== authorization.number.padStart(9, "0")) throw new Error("fiscal_xml_key_components_mismatch");
  return authorization;
}

export function assertOriginalFiscalAuthorization(expected: FiscalAuthorization, actual: FiscalAuthorization): void {
  if (["number", "series", "accessKey", "protocol"].some(key => expected[key as keyof FiscalAuthorization] !== actual[key as keyof FiscalAuthorization])
    || !Number.isFinite(Date.parse(expected.authorizedAt)) || Date.parse(expected.authorizedAt) !== Date.parse(actual.authorizedAt)) throw new Error("fiscal_artifact_authorization_mismatch");
}
