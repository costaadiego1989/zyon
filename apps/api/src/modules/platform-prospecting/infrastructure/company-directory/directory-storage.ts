type Reader={$queryRaw<T=unknown>(query:TemplateStringsArray,...values:unknown[]):Promise<T>};
type Snapshot={id:string;state:string;competence:string;parserVersion:string;manifestHash:string;manifest:unknown;counts:unknown;storageSnapshotId:string|null;storageMaxCnpj:string|null};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export async function resolveDirectoryStorage(tx:Reader,id:string){
 const [snapshot]=await tx.$queryRaw<Snapshot[]>`SELECT id,state,competence,parser_version AS "parserVersion",manifest_hash AS "manifestHash",manifest,counts,storage_snapshot_id AS "storageSnapshotId",storage_max_cnpj AS "storageMaxCnpj" FROM company_directory.company_snapshots WHERE id=${id}`;
 if(!snapshot||snapshot.state!=="published")throw new Error("snapshot_unavailable");
 if(!snapshot.storageSnapshotId&&!snapshot.storageMaxCnpj&&snapshot.parserVersion!=="rfb-cnpj-retail-read-view-v1")
  return {snapshot,storageSnapshotId:snapshot.id,maximumCnpj:null};
 const storage=object(object(snapshot.manifest).progressiveStorage),coverage=object(object(snapshot.counts).coverage);
 if(!snapshot.storageSnapshotId||!snapshot.storageMaxCnpj||snapshot.storageSnapshotId===id||!(/^[A-Z0-9]{12}[0-9]{2}$/).test(snapshot.storageMaxCnpj)
  ||snapshot.parserVersion!=="rfb-cnpj-retail-read-view-v1"||storage.snapshotId!==snapshot.storageSnapshotId||storage.maximumCnpj!==snapshot.storageMaxCnpj||coverage.scopeComplete!==false)
  throw new Error("snapshot_unavailable");
 const [parent]=await tx.$queryRaw<{id:string;competence:string;manifestHash:string;storageSnapshotId:string|null}[]>`SELECT id,competence,manifest_hash AS "manifestHash",storage_snapshot_id AS "storageSnapshotId" FROM company_directory.company_snapshots WHERE id=${snapshot.storageSnapshotId}`;
 if(!parent||parent.storageSnapshotId||parent.competence!==snapshot.competence||parent.manifestHash!==storage.parentManifestHash)throw new Error("snapshot_unavailable");
 return {snapshot,storageSnapshotId:parent.id,maximumCnpj:snapshot.storageMaxCnpj};
}
