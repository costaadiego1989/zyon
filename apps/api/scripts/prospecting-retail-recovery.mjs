import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const RETAIL_SCOPE = Object.freeze({kind:'regional_retail',ufs:['SP','RJ','MG','ES','PR','SC','RS'],mainCnaes:['4781400','4782201','4782202','4783101','4783102','4789001','4772500','4789004'],statuses:['02'],hasPhone:true,maximumDirectoryBytes:25_000_000_000});
const normalized = value => value == null ? null : value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function eligibleRetail(value) {
  return RETAIL_SCOPE.ufs.includes(value.uf) && value.status === '02' && RETAIL_SCOPE.mainCnaes.includes(value.mainCnae)
    && value.baseCnpj === value.cnpj?.slice(0,8) && /^[A-Z0-9]{12}\d{2}$/.test(value.cnpj)
    && value.contacts?.some(c => c.channel === 'phone' && /^[1-9]{2}[2-9]\d{7,8}$/.test(c.originalValue));
}
/** Skip unrelated CSV decoding while the archive reader still checks every byte and CRC. */
export function retailRecordFilter(record,family,missingRoots) {
  if(family==='empresas') {
    if(!missingRoots)return true;
    const prefix=record.subarray(0,11).toString('ascii');
    return !/^"[A-Za-z0-9]{8}";$/.test(prefix)||missingRoots.has(prefix.slice(1,9).toUpperCase());
  }
  if(family!=='estabelecimentos')return true;
  const fields={5:'',11:'',19:''};let field=0,quoted=false;
  for(const byte of record) {
    if(byte===34)quoted=!quoted;
    else if(byte===59&&!quoted){if(++field>19)break;}
    else if(Object.hasOwn(fields,field))fields[field]+=String.fromCharCode(byte);
  }
  // Unexpected layouts still reach the strict parser and fail there.
  if(field<20||quoted)return true;
  return fields[5]==='02'&&RETAIL_SCOPE.mainCnaes.includes(fields[11])&&RETAIL_SCOPE.ufs.includes(fields[19]);
}
export function retailRecoveryManifest(source) {
  const hash = digest({sourceHash:source.hash,scope:RETAIL_SCOPE,parserVersion:'rfb-cnpj-retail-recovery-v1'});
  return {...source,id:hash,hash,parserVersion:'rfb-cnpj-retail-recovery-v1',scope:{...RETAIL_SCOPE,sourceSnapshotId:source.id},resources:source.resources.filter(r=>r.family!=='simples')};
}
export class RetailRecoveryStaging {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=6103515;
      CREATE TABLE IF NOT EXISTS establishments(cnpj TEXT PRIMARY KEY,base TEXT NOT NULL,json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS establishment_root ON establishments(base);
      CREATE TABLE IF NOT EXISTS entities(base TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS domains(kind TEXT,code TEXT,json TEXT NOT NULL,PRIMARY KEY(kind,code));
      CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(id TEXT PRIMARY KEY,json TEXT NOT NULL);`);
  }
  bind(manifest) {
    const prior=this.db.prepare("SELECT json FROM metadata WHERE id='manifest'").get();
    if(prior)assert.equal(prior.json,JSON.stringify(manifest),'recovery_staging_manifest_mismatch');
    else this.db.prepare("INSERT INTO metadata VALUES ('manifest',?)").run(JSON.stringify(manifest));
  }
  count(table) { assert.ok(['establishments','entities','domains','files'].includes(table));return Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); }
  file(id) { const row=this.db.prepare('SELECT json FROM files WHERE id=?').get(id);return row?JSON.parse(row.json):null; }
  putFile(id,value) { this.db.prepare('INSERT INTO files VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id,JSON.stringify(value)); }
  entity(value) { this.db.prepare('INSERT OR IGNORE INTO entities VALUES (?,?)').run(value.baseCnpj,JSON.stringify(value)); }
  roots(after='') { return this.db.prepare('SELECT DISTINCT base FROM establishments WHERE base>? ORDER BY base LIMIT 1000').all(after).map(r=>r.base); }
  missingRoots() { return new Set(this.db.prepare('SELECT DISTINCT s.base FROM establishments s LEFT JOIN entities e ON e.base=s.base WHERE e.base IS NULL').all().map(r=>r.base)); }
  close() { this.db.close(); }
}

/** All ZIPs finish CRC validation before the prepared file is committed locally. */
export async function prepareRetailFiles({staging,manifest,reader,progress=async()=>{}}) {
  const resources=manifest.resources.filter(r=>r.family!=='empresas').sort((a,b)=>a.family.localeCompare(b.family)||a.id.localeCompare(b.id));
  for(const resource of resources) {
    if(staging.file(resource.id))continue;
    await progress({phase:'validating_sources',resourceId:resource.id,processedRows:0});
    const archive=await reader.prepare(resource);let scanned=0;
    staging.db.exec('BEGIN');
    try {
      const company=staging.db.prepare('INSERT OR IGNORE INTO establishments VALUES (?,?,?)');
      const domain=staging.db.prepare('INSERT OR IGNORE INTO domains VALUES (?,?,?)');
      for await(const row of archive.rows()) {
        scanned++;
        if(row.kind==='establishment'&&eligibleRetail(row.value))company.run(row.value.cnpj,row.value.baseCnpj,JSON.stringify(row.value));
        else if(row.kind==='domain')domain.run(row.value.kind,row.value.code,JSON.stringify(row.value));
        if(scanned%50_000===0)await progress({phase:'validating_sources',resourceId:resource.id,processedRows:scanned});
      }
      if(resource.family!=='estabelecimentos')assert.ok(scanned>0,'archive_empty_or_truncated');
      staging.putFile(resource.id,{hash:archive.fileHash,compressedBytes:archive.compressedBytes,scanned,state:'validated'});
      staging.db.exec('COMMIT');
    } catch(error) { staging.db.exec('ROLLBACK');throw error; }
    finally { await archive.close(); }
    await progress({phase:'source_validated',resourceId:resource.id,processedRows:scanned,selectedCompanies:staging.count('establishments')});
  }
  assert.ok(staging.count('establishments')>0,'recovery_empty');
  for(const code of RETAIL_SCOPE.mainCnaes)assert.ok(staging.db.prepare("SELECT 1 FROM domains WHERE kind='cnaes' AND code=?").get(code),'recovery_cnae_missing');
}

export async function prepareRetailEntities({pg,staging,manifest,sourceFiles,reader,progress=async()=>{}}) {
  let after='';
  for(;;) {
    const roots=staging.roots(after);if(!roots.length)break;
    const {rows}=await pg.query(`SELECT base_cnpj AS "baseCnpj",legal_name AS "legalName",legal_nature AS "legalNature",size,capital_cents::text AS "capitalCents",simples,mei FROM company_directory.company_entities WHERE snapshot_id=$1 AND base_cnpj=ANY($2::varchar[])`,[manifest.scope.sourceSnapshotId,roots]);
    staging.db.exec('BEGIN');try{for(const row of rows)staging.entity(row);staging.db.exec('COMMIT');}catch(error){staging.db.exec('ROLLBACK');throw error;}
    after=roots.at(-1);await progress({phase:'reusing_entities',selectedCompanies:staging.count('establishments'),selectedEntities:staging.count('entities')});
  }
  const missing=staging.missingRoots();
  for(const resource of manifest.resources.filter(r=>r.family==='empresas')) {
    if(staging.file(resource.id))continue;
    const prior=sourceFiles.find(f=>f.resourceId===resource.id);
    if(prior?.state==='validated'&&/^[a-f0-9]{64}$/.test(prior.computedHash??'')) {
      staging.putFile(resource.id,{hash:prior.computedHash,compressedBytes:prior.compressedBytes,scanned:Number(prior.rowOffset),state:'inherited',sourceSnapshotId:manifest.scope.sourceSnapshotId});continue;
    }
    await progress({phase:'loading_missing_entities',resourceId:resource.id,missingEntities:missing.size});
    const archive=await reader.prepare(resource);let scanned=0;
    staging.db.exec('BEGIN');
    try {
      for await(const row of archive.rows()) {
        scanned++;
        if(row.kind==='entity'&&missing.has(row.value.baseCnpj))staging.entity(row.value);
        if(scanned%250_000===0)await progress({phase:'loading_missing_entities',resourceId:resource.id,processedRows:scanned});
      }
      staging.putFile(resource.id,{hash:archive.fileHash,compressedBytes:archive.compressedBytes,scanned,state:'validated'});staging.db.exec('COMMIT');
    }catch(error){staging.db.exec('ROLLBACK');throw error;}finally{await archive.close();}
  }
  assert.equal(staging.missingRoots().size,0,'recovery_missing_entities');
  assert.equal(staging.count('files'),manifest.resources.length,'recovery_sources_incomplete');
}

export async function assertRetailDirectoryBudget(pg,reserveBytes=0) {
  const {rows}=await pg.query("SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='company_directory' AND c.relkind IN ('r','m')");
  if(!/^\d+$/.test(rows[0]?.bytes??''))throw Error('production_storage_measurement_unavailable');
  if(BigInt(rows[0].bytes)+BigInt(reserveBytes)>BigInt(RETAIL_SCOPE.maximumDirectoryBytes))throw Error('retail_directory_25gb_limit');
  return rows[0].bytes;
}
function assertPreparedRetail(staging,manifest) {
  assert.equal(manifest.parserVersion,'rfb-cnpj-retail-recovery-v1','recovery_manifest_mismatch');
  assert.deepEqual(Object.fromEntries(Object.keys(RETAIL_SCOPE).map(k=>[k,manifest.scope[k]])),RETAIL_SCOPE,'recovery_scope_mismatch');
  assert.equal(manifest.resources.length,23,'recovery_sources_incomplete');
  assert.equal(new Set(manifest.resources.map(r=>r.id)).size,23,'recovery_sources_incomplete');
  assert.equal(staging.count('files'),23,'recovery_sources_incomplete');
  for(const resource of manifest.resources){const f=staging.file(resource.id);assert.ok(f&&['validated','inherited'].includes(f.state),'recovery_sources_incomplete');assert.match(f.hash,/^[a-f0-9]{64}$/);}
  assert.ok(staging.count('establishments')>0,'recovery_empty');
  assert.equal(staging.missingRoots().size,0,'recovery_missing_entities');
}

/** Only this run's unpublished raw directory is reclaimed. Public business data is never truncated. */
export async function reclaimFailedDirectory(pg,{sourceSnapshotId,snapshotId,actor,staging,manifest}) {
  assertPreparedRetail(staging,manifest);assert.equal(manifest.id,snapshotId);assert.equal(manifest.scope.sourceSnapshotId,sourceSnapshotId);
  await pg.query('BEGIN');
  try {
    await pg.query("SELECT pg_advisory_xact_lock(hashtext('zyon_company_directory_publish'))");
    const snapshots=(await pg.query('SELECT id,state,published_at,counts FROM company_directory.company_snapshots FOR UPDATE')).rows;
    const old=snapshots.find(s=>s.id===sourceSnapshotId),next=snapshots.find(s=>s.id===snapshotId);
    assert.ok(old&&next,'recovery_snapshot_missing');
    if(old.counts.supersededBy===snapshotId){await pg.query('COMMIT');return;}
    assert.ok(snapshots.length===2&&old.state==='failed'&&!old.published_at&&!old.counts.leaseToken&&['importing','discovered','failed'].includes(next.state),'recovery_source_not_owned');
    assert.equal((await pg.query('SELECT 1 FROM company_directory.active_snapshot LIMIT 1')).rowCount,0,'recovery_active_snapshot_exists');
    for(const sql of [
      'SELECT 1 FROM public.platform_prospects WHERE source_snapshot_id=$1 LIMIT 1',
      'SELECT 1 FROM public.prospect_audience_jobs WHERE snapshot_id=$1 LIMIT 1',
      "SELECT 1 FROM public.campaign_recipients WHERE frozen_snapshot->>'snapshotId'=$1 LIMIT 1"
    ])assert.equal((await pg.query(sql,[sourceSnapshotId])).rowCount,0,'recovery_source_in_use');
    for(const table of ['company_establishments','company_public_contacts','establishment_secondary_cnaes','source_domains'])
      assert.equal((await pg.query(`SELECT 1 FROM company_directory.${table} LIMIT 1`)).rowCount,0,'recovery_staging_not_empty');
    assert.equal((await pg.query('SELECT 1 FROM company_directory.company_entities WHERE snapshot_id=$1 LIMIT 1',[snapshotId])).rowCount,0,'recovery_target_not_empty');
    await pg.query('TRUNCATE company_directory.company_public_contacts, company_directory.establishment_secondary_cnaes, company_directory.company_establishments, company_directory.company_entities');
    await pg.query("UPDATE company_directory.company_snapshots SET error_code='import_superseded',counts=counts||$2::jsonb,updated_at=now() WHERE id=$1",[sourceSnapshotId,JSON.stringify({supersededBy:snapshotId,stagingReclaimedAt:new Date().toISOString(),requested:false,leaseToken:null,leaseUntil:0})]);
    await pg.query("INSERT INTO public.prospect_audit_events(id,actor_operator_id,action,resource_type,resource_id,resource_version,correlation_id,outcome) VALUES ($1,$2,'company_import_reclaim','company_snapshot',$3,1,$4,'superseded')",[randomUUID(),actor.operatorId,sourceSnapshotId,actor.correlationId]);
    await pg.query('COMMIT');
  }catch(error){await pg.query('ROLLBACK');throw error;}
}

export async function persistRetailDirectory({pg,staging,manifest,guard,progress=async()=>{}}) {
  assert.equal(staging.count('files'),manifest.resources.length,'recovery_sources_incomplete');
  assert.equal(staging.missingRoots().size,0,'recovery_missing_entities');
  const write=async callback=>{
    await pg.query('BEGIN');
    try{await guard(pg,async()=>{await assertRetailDirectoryBudget(pg,256*1024**2);await callback();await assertRetailDirectoryBudget(pg);});await pg.query('COMMIT');}
    catch(error){await pg.query('ROLLBACK');throw error;}
  };
  for(const table of ['entities','establishments','domains']) {
    const key=table==='entities'?'base':table==='establishments'?'cnpj':"kind||':'||code";let after='';
    for(;;) {
      const rows=staging.db.prepare(`SELECT ${key} AS key,json FROM ${table} WHERE ${key}>? ORDER BY ${key} LIMIT 500`).all(after);if(!rows.length)break;
      // Bound every transaction's encoded payload as well as its row count.
      let bytes=0;const batch=[];for(const row of rows){if(batch.length&&bytes+row.json.length*3>4*1024**2)break;bytes+=row.json.length*3;batch.push(row);}
      const values=batch.map(r=>JSON.parse(r.json));
      await write(async()=>{
        if(table==='entities')await pg.query(`INSERT INTO company_directory.company_entities(snapshot_id,base_cnpj,legal_name,normalized_legal_name,legal_nature,size,capital_cents,simples,mei)
          SELECT $1,x."baseCnpj",x."legalName",x.normalized,x."legalNature",x.size,x."capitalCents"::numeric,x.simples,x.mei FROM jsonb_to_recordset($2::jsonb) AS x("baseCnpj" text,"legalName" text,normalized text,"legalNature" text,size text,"capitalCents" text,simples boolean,mei boolean) ON CONFLICT DO NOTHING`,[manifest.id,JSON.stringify(values.map(v=>({...v,normalized:normalized(v.legalName)})))]);
        else if(table==='domains')await pg.query(`INSERT INTO company_directory.source_domains(snapshot_id,kind,code,label) SELECT $1,x.kind,x.code,x.label FROM jsonb_to_recordset($2::jsonb) AS x(kind text,code text,label text) ON CONFLICT DO NOTHING`,[manifest.id,JSON.stringify(values)]);
        else {
          for(const value of values)assert.ok(eligibleRetail(value),'recovery_row_outside_scope');
          await pg.query(`INSERT INTO company_directory.company_establishments(snapshot_id,cnpj,base_cnpj,trade_name,normalized_trade_name,main_cnae,city_code,uf,district,normalized_district,opening_date,status,matrix_branch)
            SELECT $1,x.cnpj,x."baseCnpj",x."tradeName",x.normalized,x."mainCnae",x."cityCode",x.uf,x.district,x."normalizedDistrict",x."openingDate"::date,x.status,x."matrixBranch" FROM jsonb_to_recordset($2::jsonb) AS x(cnpj text,"baseCnpj" text,"tradeName" text,normalized text,"mainCnae" text,"cityCode" text,uf text,district text,"normalizedDistrict" text,"openingDate" text,status text,"matrixBranch" text) ON CONFLICT DO NOTHING`,[manifest.id,JSON.stringify(values.map(v=>({...v,normalized:normalized(v.tradeName),normalizedDistrict:normalized(v.district)})))]);
          const contacts=values.flatMap(v=>v.contacts.map(c=>({id:randomUUID(),cnpj:v.cnpj,...c}))),secondary=values.flatMap(v=>v.secondaryCnaes.map(cnae=>({cnpj:v.cnpj,cnae})));
          if(contacts.length)await pg.query(`INSERT INTO company_directory.company_public_contacts(id,snapshot_id,cnpj,channel,original_value,normalized_value,validation_state) SELECT x.id,$1,x.cnpj,x.channel,x."originalValue",x."normalizedValue",x."validationState" FROM jsonb_to_recordset($2::jsonb) AS x(id text,cnpj text,channel text,"originalValue" text,"normalizedValue" text,"validationState" text) ON CONFLICT DO NOTHING`,[manifest.id,JSON.stringify(contacts)]);
          if(secondary.length)await pg.query(`INSERT INTO company_directory.establishment_secondary_cnaes(snapshot_id,cnpj,cnae) SELECT $1,x.cnpj,x.cnae FROM jsonb_to_recordset($2::jsonb) AS x(cnpj text,cnae text) ON CONFLICT DO NOTHING`,[manifest.id,JSON.stringify(secondary)]);
        }
      });
      after=batch.at(-1).key;await progress({phase:'persisting_'+table,lastKey:after});
    }
  }
}

export async function publishRetailDirectory(pg,staging,manifest,actor) {
  assertPreparedRetail(staging,manifest);
  await pg.query('BEGIN');
  try {
    await pg.query("SELECT pg_advisory_xact_lock(hashtext('zyon_company_directory_publish'))");
    const target=(await pg.query('SELECT state,manifest FROM company_directory.company_snapshots WHERE id=$1 FOR UPDATE',[manifest.id])).rows[0];
    assert.equal(target?.manifest?.hash,manifest.hash,'recovery_manifest_mismatch');
    const pointer=(await pg.query('SELECT snapshot_id FROM company_directory.active_snapshot')).rows[0];
    if(target.state==='published'&&pointer?.snapshot_id===manifest.id){await pg.query('COMMIT');return;}
    assert.ok(!pointer,'active_snapshot_conflict');
    assert.equal(staging.count('files'),manifest.resources.length,'recovery_sources_incomplete');
    const count=(await pg.query('SELECT count(*)::int AS n FROM company_directory.company_establishments WHERE snapshot_id=$1',[manifest.id])).rows[0].n;
    assert.ok(count>0&&count===staging.count('establishments'),'recovery_count_mismatch');
    const domains=(await pg.query('SELECT count(*)::int AS n FROM company_directory.source_domains WHERE snapshot_id=$1',[manifest.id])).rows[0].n;
    assert.equal(domains,staging.count('domains'),'recovery_domains_mismatch');
    const bytes=await assertRetailDirectoryBudget(pg);
    for(const resource of manifest.resources){const f=staging.file(resource.id);assert.match(f.hash,/^[a-f0-9]{64}$/);await pg.query('UPDATE company_directory.company_source_files SET state=$3,computed_hash=$4,compressed_bytes=$5 WHERE snapshot_id=$1 AND resource_id=$2',[manifest.id,resource.id,f.state,f.hash,f.compressedBytes]);}
    const coverage={...RETAIL_SCOPE,companyCount:count,directoryBytes:bytes,sourceSnapshotId:manifest.scope.sourceSnapshotId,sourceFileCount:manifest.resources.length,scopeComplete:true};
    await pg.query("UPDATE company_directory.company_snapshots SET state='published',published_at=now(),available_filters=ARRAY['cadastral','contact','commercial'],error_code=NULL,counts=counts||$2::jsonb,updated_at=now() WHERE id=$1",[manifest.id,JSON.stringify({coverage,requested:false,leaseToken:null,leaseUntil:0,progress:{phase:'completed',selectedCompanies:count,validatedFiles:manifest.resources.length,requiredFiles:manifest.resources.length,updatedAt:new Date().toISOString()}})]);
    await pg.query("INSERT INTO company_directory.active_snapshot(id,snapshot_id,version,updated_at) VALUES ('national',$1,1,now())",[manifest.id]);
    await pg.query("INSERT INTO public.prospect_audit_events(id,actor_operator_id,action,resource_type,resource_id,resource_version,correlation_id,outcome) VALUES ($1,$2,'company_import_publish','company_snapshot',$3,1,$4,'regional_retail_published')",[randomUUID(),actor.operatorId,manifest.id,actor.correlationId]);
    await pg.query('COMMIT');return coverage;
  }catch(error){await pg.query('ROLLBACK');throw error;}
}
