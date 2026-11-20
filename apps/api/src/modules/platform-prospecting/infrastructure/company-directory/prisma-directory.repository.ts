import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../../../node_modules/.prisma/company-directory/index.js";
import type { CompanyImportStatus, CompanyManifest, CompanySnapshotState } from "@zyon/shared-types";
import type { DirectoryBatch, DirectoryImportRepositoryPort, PreparedDirectoryArchive } from "../../domain/prospecting.ports.js";
import { assertCompleteDirectoryManifest } from "../../domain/company-directory/directory-manifest.js";
import { canonicalCnpj } from "../../domain/company-directory/cnpj.js";
import { normalizeDirectoryText, stableDirectoryJson } from "../../domain/company-directory/directory-values.js";

export class PrismaDirectoryRepository implements DirectoryImportRepositoryPort {
  constructor(readonly client: PrismaClient) {}
  async saveManifest(manifest: CompanyManifest): Promise<CompanyImportStatus> {
    if (!manifest.resources.length || manifest.resources.some(r=>r.competence!==manifest.competence) || new Set(manifest.resources.map(r=>r.id)).size!==manifest.resources.length) throw new Error("manifest_invalid");
    const snapshot = await this.client.companySnapshot.upsert({where:{competence_manifestHash:{competence:manifest.competence,manifestHash:manifest.hash}},update:{},create:{id:manifest.id,competence:manifest.competence,manifestHash:manifest.hash,manifest:manifest as unknown as Prisma.InputJsonValue,parserVersion:manifest.parserVersion,sourceUrl:manifest.resources[0].url,files:{create:manifest.resources.map(r=>({resourceId:r.id,family:r.family,url:r.url,etag:r.etag,lastModified:r.lastModified,encoding:"win1252"}))}}});
    return (await this.getImport(snapshot.id))!;
  }
  async getImport(id: string): Promise<CompanyImportStatus | null> {
    const snapshot = await this.client.companySnapshot.findUnique({where:{id},include:{files:{include:{checkpoints:{orderBy:{batchIndex:"desc"},take:1}},orderBy:{resourceId:"asc"}}}});
    if (!snapshot) return null;
    const active = await this.client.companyDirectoryActiveSnapshot.findUnique({where:{id:"national"}});
    return {id:snapshot.id,snapshotId:snapshot.id,competence:snapshot.competence,state:snapshot.state as CompanySnapshotState,committedCount:snapshot.files.reduce((n,f)=>n+Number(f.committedCount),0),rejectedCount:snapshot.rejectedCount,files:snapshot.files.map(f=>({id:f.id,resourceId:f.resourceId,state:f.state,batchIndex:f.checkpoints[0]?.batchIndex??-1,computedHash:f.computedHash,errorCode:f.errorCode})),activeSnapshotId:active?.snapshotId??null,errorCode:snapshot.errorCode};
  }
  async commitBatch(batch: DirectoryBatch): Promise<{committed:number;replay:boolean}> {
    if (!/^[a-f0-9]{64}$/.test(batch.fileHash) || [batch.batchIndex,batch.rowOffset,batch.byteOffset,batch.rejectedCount??0].some(n=>!Number.isSafeInteger(n)||n<0)) throw new Error("batch_invalid");
    if (batch.entities.length+batch.establishments.length+batch.domains.length+(batch.taxes?.length??0)+(batch.rejectedCount??0)>100_000) throw new Error("batch_limit");
    for (const record of batch.establishments) if (canonicalCnpj(record.cnpj)!==record.cnpj || record.baseCnpj!==record.cnpj.slice(0,8)) throw new Error("invalid_cnpj");
    const {ownerToken:_owner,...content}=batch;
    const batchHash=createHash("sha256").update(stableDirectoryJson(content)).digest("hex");
    return this.client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM company_directory.company_snapshots WHERE id=${batch.snapshotId} FOR UPDATE`;
      const file=await tx.companySourceFile.findUnique({where:{id:batch.fileId},include:{snapshot:true,checkpoints:{orderBy:{batchIndex:"desc"},take:1}}});
      if (!file || file.snapshotId!==batch.snapshotId) throw new Error("file_snapshot_mismatch");
      const metadata=file.snapshot.counts as Record<string,unknown>;
      if(metadata.leaseToken && metadata.leaseToken!==batch.ownerToken)throw new Error("import_lease_lost");
      if (file.computedHash && file.computedHash!==batch.fileHash) throw new Error("source_changed");
      const existing=await tx.companyImportCheckpoint.findUnique({where:{fileId_batchIndex:{fileId:batch.fileId,batchIndex:batch.batchIndex}}});
      if (existing) { if (existing.batchHash!==batchHash) throw new Error("batch_conflict"); return {committed:existing.committedCount,replay:true}; }
      if (!["discovered","importing","failed"].includes(file.snapshot.state)) throw new Error("snapshot_not_writable");
      const previous=file.checkpoints[0];
      if (batch.batchIndex!==(previous?previous.batchIndex+1:0) || batch.rowOffset<=Number(previous?.rowOffset??-1)) throw new Error("checkpoint_out_of_order");
      if (batch.entities.length) await tx.companyEntity.createMany({skipDuplicates:true,data:batch.entities.map(e=>({...e,snapshotId:batch.snapshotId,normalizedLegalName:normalizeDirectoryText(e.legalName)}))});
      if (batch.establishments.length) {
        await tx.companyEstablishment.createMany({skipDuplicates:true,data:batch.establishments.map(({secondaryCnaes:_secondary,contacts:_contacts,...e})=>({...e,snapshotId:batch.snapshotId,normalizedTradeName:e.tradeName===null?null:normalizeDirectoryText(e.tradeName),normalizedDistrict:e.district===null?null:normalizeDirectoryText(e.district),openingDate:e.openingDate?new Date(e.openingDate):null}))});
        const secondary=batch.establishments.flatMap(e=>e.secondaryCnaes.map(cnae=>({snapshotId:batch.snapshotId,cnpj:e.cnpj,cnae})));
        const contacts=batch.establishments.flatMap(e=>e.contacts.map(contact=>({...contact,snapshotId:batch.snapshotId,cnpj:e.cnpj})));
        if (secondary.length) await tx.establishmentSecondaryCnae.createMany({data:secondary,skipDuplicates:true});
        if (contacts.length) await tx.companyPublicContact.createMany({data:contacts,skipDuplicates:true});
      }
      if (batch.domains.length) await tx.sourceDomain.createMany({data:batch.domains.map(d=>({...d,snapshotId:batch.snapshotId})),skipDuplicates:true});
      if (batch.taxes?.length) {
        const updated=await tx.$executeRaw`UPDATE company_directory.company_entities e SET simples=t.simples,mei=t.mei FROM jsonb_to_recordset(${JSON.stringify(batch.taxes)}::jsonb) AS t("baseCnpj" text,simples boolean,mei boolean) WHERE e.snapshot_id=${batch.snapshotId} AND e.base_cnpj=t."baseCnpj"`;
        if (updated!==batch.taxes.length) throw new Error("tax_entity_missing");
      }
      const committed=batch.entities.length+batch.establishments.length+batch.domains.length+(batch.taxes?.length??0);
      await tx.companySourceFile.update({where:{id:file.id},data:{computedHash:batch.fileHash,state:"importing",committedCount:{increment:committed},rejectedCount:{increment:batch.rejectedCount??0}}});
      await tx.companyImportCheckpoint.create({data:{fileId:batch.fileId,batchIndex:batch.batchIndex,fileHash:batch.fileHash,rowOffset:batch.rowOffset,byteOffset:batch.byteOffset,committedCount:committed,batchHash}});
      const reasons={...metadata.rejectedReasons as Record<string,number>??{}};
      for(const [code,count] of Object.entries(batch.rejectedReasons??{}))reasons[code]=(reasons[code]??0)+count;
      await tx.companySnapshot.update({where:{id:batch.snapshotId},data:{state:"importing",rejectedCount:{increment:batch.rejectedCount??0},counts:{...metadata,rejectedReasons:reasons,leaseUntil:batch.ownerToken?Date.now()+600_000:0} as Prisma.InputJsonValue}});
      return {committed,replay:false};
    },{timeout:30_000});
  }
  async getManifest(id:string):Promise<CompanyManifest|null>{return (await this.client.companySnapshot.findUnique({where:{id},select:{manifest:true}}))?.manifest as unknown as CompanyManifest??null;}
  async claimImport(id:string,ownerToken:string,now:Date):Promise<{expectedActiveSnapshotId:string|null}>{
    return this.client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM company_directory.company_snapshots WHERE id=${id} FOR UPDATE`;
      const snapshot=await tx.companySnapshot.findUniqueOrThrow({where:{id}});const counts=snapshot.counts as Record<string,unknown>;
      if(counts.leaseToken&&Number(counts.leaseUntil)>now.getTime())throw new Error("import_busy");
      if(snapshot.state==="published")throw new Error("snapshot_not_writable");
      const active=await tx.companyDirectoryActiveSnapshot.findUnique({where:{id:"national"}});
      const expectedActiveSnapshotId=Object.hasOwn(counts,"expectedActiveSnapshotId")?counts.expectedActiveSnapshotId as string|null:active?.snapshotId??null;
      await tx.companySnapshot.update({where:{id},data:{state:"importing",errorCode:null,counts:{...counts,leaseToken:ownerToken,leaseUntil:now.getTime()+600_000,expectedActiveSnapshotId} as Prisma.InputJsonValue}});
      return {expectedActiveSnapshotId};
    });
  }
  private async owned<T>(id:string,ownerToken:string,action:(tx:Prisma.TransactionClient,counts:Record<string,unknown>)=>Promise<T>):Promise<T>{
    return this.client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM company_directory.company_snapshots WHERE id=${id} FOR UPDATE`;
      const snapshot=await tx.companySnapshot.findUniqueOrThrow({where:{id}});const counts=snapshot.counts as Record<string,unknown>;
      if(counts.leaseToken!==ownerToken)throw new Error("import_lease_lost");return action(tx,counts);
    });
  }
  async beginFile(snapshotId:string,fileId:string,ownerToken:string,archive:Pick<PreparedDirectoryArchive,"fileHash"|"compressedBytes">):Promise<void>{
    await this.owned(snapshotId,ownerToken,async tx=>{
      const file=await tx.companySourceFile.findUniqueOrThrow({where:{id:fileId}});
      if(file.snapshotId!==snapshotId)throw new Error("file_snapshot_mismatch");if(file.computedHash&&file.computedHash!==archive.fileHash)throw new Error("source_changed");
      await tx.companySourceFile.update({where:{id:fileId},data:{computedHash:archive.fileHash,compressedBytes:archive.compressedBytes,state:"importing",errorCode:null}});
    });
  }
  async validateFile(snapshotId:string,fileId:string,ownerToken:string):Promise<void>{
    await this.owned(snapshotId,ownerToken,async tx=>{
      const file=await tx.companySourceFile.findUniqueOrThrow({where:{id:fileId},include:{checkpoints:true}});
      if(file.snapshotId!==snapshotId||!file.computedHash||!file.checkpoints.length||file.checkpoints.some(c=>c.fileHash!==file.computedHash))throw new Error("file_not_validated");
      await tx.companySourceFile.update({where:{id:fileId},data:{state:"validated",errorCode:null}});
    });
  }
  async readyImport(snapshotId:string,ownerToken:string):Promise<void>{
    await this.owned(snapshotId,ownerToken,async tx=>{
      const snapshot=await tx.companySnapshot.findUniqueOrThrow({where:{id:snapshotId},include:{files:true}});assertCompleteDirectoryManifest(snapshot.manifest as unknown as CompanyManifest);
      if(snapshot.files.some(f=>f.state!=="validated"||!f.computedHash)||snapshot.files.length!==24)throw new Error("snapshot_not_ready");
      if(!await tx.companyEstablishment.count({where:{snapshotId}})||!await tx.companyEntity.count({where:{snapshotId}}))throw new Error("snapshot_empty");
      await tx.companySnapshot.update({where:{id:snapshotId},data:{state:"ready",availableFilters:["cadastral","contact","simples","mei","commercial"]}});
    });
  }
  async failImport(snapshotId:string,ownerToken:string,fileId:string|null,errorCode:string):Promise<void>{
    await this.owned(snapshotId,ownerToken,async(tx,counts)=>{
      await tx.companySnapshot.update({where:{id:snapshotId},data:{state:"failed",errorCode,counts:{...counts,leaseToken:null,leaseUntil:0} as Prisma.InputJsonValue}});
      if(fileId)await tx.companySourceFile.updateMany({where:{id:fileId,snapshotId,state:{not:"validated"}},data:{state:"failed",errorCode}});
    });
  }
  async publish(snapshotId:string,expectedActiveSnapshotId:string|null):Promise<void>{
    await this.client.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('zyon_company_directory_publish'))::text`;
      const snapshot=await tx.companySnapshot.findUniqueOrThrow({where:{id:snapshotId},include:{files:true}});
      if(snapshot.state!=="ready"||snapshot.files.some(f=>f.state!=="validated"||!f.computedHash))throw new Error("snapshot_not_ready");assertCompleteDirectoryManifest(snapshot.manifest as unknown as CompanyManifest);
      const pointer=await tx.companyDirectoryActiveSnapshot.findUnique({where:{id:"national"}});
      if((pointer?.snapshotId??null)!==expectedActiveSnapshotId)throw new Error("active_snapshot_conflict");
      await tx.companyDirectoryActiveSnapshot.upsert({where:{id:"national"},create:{snapshotId},update:{snapshotId,version:{increment:1}}});
      const counts=snapshot.counts as Record<string,unknown>;
      await tx.companySnapshot.update({where:{id:snapshotId},data:{state:"published",publishedAt:new Date(),counts:{...counts,leaseToken:null,leaseUntil:0} as Prisma.InputJsonValue}});
    });
  }
}
