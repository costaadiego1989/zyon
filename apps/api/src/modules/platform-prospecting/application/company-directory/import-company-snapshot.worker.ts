import { randomUUID } from "node:crypto";
import type { CompanyImportStatus } from "@zyon/shared-types";
import type { DirectoryArchivePort, DirectoryBatch, DirectoryImportRepositoryPort } from "../../domain/prospecting.ports.js";
import { assertCompleteDirectoryManifest } from "../../domain/company-directory/directory-manifest.js";

export class ImportCompanySnapshotWorker {
  constructor(private readonly repository:DirectoryImportRepositoryPort,private readonly archives:DirectoryArchivePort,private readonly config:{ingestionEnabled:boolean;importBatchSize:number}){
    if(!Number.isSafeInteger(config.importBatchSize)||config.importBatchSize<1||config.importBatchSize>100_000)throw new Error("config_invalid:IMPORT_BATCH_SIZE");
  }
  async run(id:string):Promise<CompanyImportStatus>{
    if(!this.config.ingestionEnabled)throw new Error("ingestion_disabled");
    const manifest=await this.repository.getManifest(id);if(!manifest)throw new Error("import_not_found");assertCompleteDirectoryManifest(manifest);
    const status=await this.repository.getImport(id);if(status?.state==="published")return status;
    const ownerToken=randomUUID();const claim=await this.repository.claimImport(id,ownerToken,new Date());let fileId:string|null=null;
    try{
      const priority=["empresas","simples","cnaes","municipios","naturezas","estabelecimentos"];
      for(const resource of [...manifest.resources].sort((a,b)=>priority.indexOf(a.family)-priority.indexOf(b.family)||a.id.localeCompare(b.id))){
        const file=(await this.repository.getImport(id))!.files.find(f=>f.resourceId===resource.id)!;fileId=file.id;if(file.state==="validated")continue;
        const archive=await this.archives.prepare(resource);
        try{
          await this.repository.beginFile(id,file.id,ownerToken,archive);let batchIndex=0;let rowOffset=0;let buffered=0;
          const empty=():DirectoryBatch=>({snapshotId:id,fileId:file.id,fileHash:archive.fileHash,batchIndex,rowOffset,byteOffset:0,entities:[],establishments:[],domains:[],taxes:[],rejectedCount:0,rejectedReasons:{},ownerToken});
          let batch=empty();
          const flush=async()=>{batch.rowOffset=rowOffset;await this.repository.commitBatch(batch);batchIndex++;buffered=0;batch=empty();};
          for await(const row of archive.rows()){
            rowOffset++;buffered++;
            if(row.kind==="entity")batch.entities.push(row.value);else if(row.kind==="establishment")batch.establishments.push(row.value);else if(row.kind==="domain")batch.domains.push(row.value);else if(row.kind==="tax")batch.taxes!.push(row.value);else{batch.rejectedCount!++;batch.rejectedReasons![row.errorCode]=(batch.rejectedReasons![row.errorCode]??0)+1;}
            if(buffered===this.config.importBatchSize)await flush();
          }
          if(buffered)await flush();if(!rowOffset)throw new Error("archive_empty");
          await this.repository.validateFile(id,file.id,ownerToken);
        }finally{await archive.close();}
      }
      await this.repository.readyImport(id,ownerToken);await this.repository.publish(id,claim.expectedActiveSnapshotId);
      return (await this.repository.getImport(id))!;
    }catch(error){await this.repository.failImport(id,ownerToken,fileId,(error as Error).message);throw error;}
  }
}
