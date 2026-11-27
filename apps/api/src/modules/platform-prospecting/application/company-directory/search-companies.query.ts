import { createHash,createHmac,timingSafeEqual } from "node:crypto";
import type { CompanySearchQuery,CompanySearchResult } from "@zyon/shared-types";
import type { DirectoryReadPort } from "../../domain/prospecting.ports.js";
import { validateCompanyFilters,companyPageLimit } from "../../domain/company-directory/company-filters.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";
interface Cursor {v:1;snapshotId:string;filterHash:string;sort:"cnpj_asc";lastCnpj:string}
export class SearchCompaniesQuery {
  constructor(private readonly directory:DirectoryReadPort,private readonly cursorHmacKey:string){if(!/^[a-f0-9]{64}$/i.test(cursorHmacKey))throw new Error("config_invalid:CURSOR_HMAC_KEY");}
  private signature(value:string){return createHmac("sha256",Buffer.from(this.cursorHmacKey,"hex")).update(value).digest("base64url");}
  private readCursor(value:string):Cursor{
    try{if(value.length>4096||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))throw new Error();const [body,signature]=value.split(".");const expected=Buffer.from(this.signature(body));const received=Buffer.from(signature);if(expected.length!==received.length||!timingSafeEqual(expected,received))throw new Error();const cursor=JSON.parse(Buffer.from(body,"base64url").toString("utf8")) as Cursor;if(cursor.v!==1||cursor.sort!=="cnpj_asc"||typeof cursor.snapshotId!=="string"||!/^[A-Z0-9]{12}\d{2}$/.test(cursor.lastCnpj)||!/^[a-f0-9]{64}$/.test(cursor.filterHash))throw new Error();return cursor;}catch{throw new Error("invalid_cursor");}
  }
  async execute(query:CompanySearchQuery):Promise<CompanySearchResult>{
    const filters=validateCompanyFilters(query.filters);const limit=companyPageLimit(query.limit);const filterHash=createHash("sha256").update(stableDirectoryJson(filters)).digest("hex");
    const cursor=query.cursor===undefined?null:this.readCursor(query.cursor);if(cursor&&(cursor.filterHash!==filterHash||query.snapshotId!==undefined&&cursor.snapshotId!==query.snapshotId))throw new Error("invalid_cursor");
    const snapshotId=cursor?.snapshotId??query.snapshotId??await this.directory.activeSnapshotId();if(!snapshotId)throw new Error("directory_unavailable");
    if(typeof snapshotId!=="string"||!snapshotId||snapshotId.length>200)throw new Error("invalid_filter:snapshotId");
    const result=await this.directory.readPage(snapshotId,filters,cursor?.lastCnpj??null,limit+1);const items=result.items.slice(0,limit);
    const body=Buffer.from(JSON.stringify({v:1,snapshotId,filterHash,sort:"cnpj_asc",lastCnpj:items.at(-1)?.cnpj})).toString("base64url");
    return {items,count:result.count,countState:"complete",snapshotId,competence:result.competence,filterHash,nextCursor:result.items.length>limit?`${body}.${this.signature(body)}`:null};
  }
}
