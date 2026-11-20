import { PDFDocument, StandardFonts } from "pdf-lib";
export function fiscalXmlFixture(issuer: string, patch: { issuer?: string; number?: string; series?: string; model?: string; environment?: string; protocol?: string; key?: string } = {}): Uint8Array {
  const key = patch.key ?? "352611" + issuer + "550010000000221123456780";
  return Uint8Array.from(Buffer.from(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><cUF>35</cUF><tpAmb>${patch.environment ?? "2"}</tpAmb><mod>${patch.model ?? "55"}</mod><nNF>${patch.number ?? "22"}</nNF><serie>${patch.series ?? "1"}</serie></ide><emit><CNPJ>${patch.issuer ?? issuer}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>${patch.environment ?? "2"}</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>${patch.protocol ?? "151260029467289"}</nProt><dhRecbto>2026-11-14T15:00:00Z</dhRecbto></infProt></protNFe></nfeProc>`));
}
export async function fiscalPdfFixture(objectStreams = true): Promise<Uint8Array> {
  const document = await PDFDocument.create(); document.setCreationDate(new Date("2026-11-14T15:00:00Z")); document.setModificationDate(new Date("2026-11-14T15:00:00Z"));
  const font = await document.embedFont(StandardFonts.Helvetica); document.addPage([595, 842]).drawText("DANFE SINTETICO - SEM VALIDADE FISCAL", { x: 20, y: 800, size: 12, font });
  return document.save({ useObjectStreams: objectStreams, addDefaultPage: false });
}
