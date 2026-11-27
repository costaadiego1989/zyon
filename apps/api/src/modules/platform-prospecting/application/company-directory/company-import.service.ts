import { createHash } from "node:crypto";
import type { CompanyImportAccepted,ImportCompanySnapshot } from "@zyon/shared-types";
import type { DirectoryImportManagementPort,DirectoryManifestPort,ProspectingActor } from "../../domain/prospecting.ports.js";
import { assertCompleteDirectoryManifest } from "../../domain/company-directory/directory-manifest.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";
export class CompanyImportService {
  constructor(private readonly repository:DirectoryImportManagementPort,private readonly source:DirectoryManifestPort,private readonly config:{ingestionEnabled:boolean}){}
  private commandId(value:string){if(typeof value!=="string"||!/^[-A-Za-z0-9_.:]{1,160}$/.test(value))throw new Error("invalid_command:clientRequestId");}
  private competence(value:string){if(typeof value!=="string"||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))throw new Error("invalid_command:competence");}
  private hash(value:unknown){return createHash("sha256").update(stableDirectoryJson(value)).digest("hex");}
  competences(){return this.source.competences();}
  manifest(competence:string){this.competence(competence);return this.source.discover(competence);}
  async status(id:string){if(typeof id!=="string"||!id||id.length>200)throw new Error("invalid_command:importJobId");const status=await this.repository.getImport(id);if(!status)throw new Error("import_not_found");return status;}
  async start(command:ImportCompanySnapshot,actor:ProspectingActor):Promise<CompanyImportAccepted>{
    if(!this.config.ingestionEnabled)throw new Error("ingestion_disabled");this.commandId(command.clientRequestId);this.competence(command.competence);if(typeof command.manifestId!=="string"||!command.manifestId||command.manifestId.length>200)throw new Error("invalid_command:manifestId");
    const requestHash=this.hash({action:"start",...command});const replay=await this.repository.getImportCommand(command.clientRequestId,requestHash,actor);if(replay)return {importJobId:replay,status:await this.status(replay)};
    const manifest=await this.source.discover(command.competence);if(manifest.id!==command.manifestId||manifest.competence!==command.competence)throw new Error("manifest_changed_conflict");assertCompleteDirectoryManifest(manifest);
    const id=await this.repository.enqueueImport({snapshotId:manifest.id,manifest,action:"start",clientRequestId:command.clientRequestId,requestHash},actor);return {importJobId:id,status:await this.status(id)};
  }
  async resume(id:string,clientRequestId:string,actor:ProspectingActor):Promise<CompanyImportAccepted>{
    if(!this.config.ingestionEnabled)throw new Error("ingestion_disabled");this.commandId(clientRequestId);const requestHash=this.hash({action:"resume",id});
    const replay=await this.repository.getImportCommand(clientRequestId,requestHash,actor);if(replay)return {importJobId:replay,status:await this.status(replay)};
    await this.status(id);const job=await this.repository.enqueueImport({snapshotId:id,action:"resume",clientRequestId,requestHash},actor);return {importJobId:job,status:await this.status(job)};
  }
}
