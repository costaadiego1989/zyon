const assert=require('node:assert/strict'),{Client}=require('pg');
async function main(){
 assert.equal(process.cwd(),'/repo/apps/api');const id=process.argv[2];assert.match(id,/^[a-f0-9]{64}$/);
 const {markInterruptedRetailImport}=await import('./prospecting-retail-recovery.mjs'),pg=new Client({connectionString:process.env.DATABASE_URL});await pg.connect();
 try{
  assert.equal((await pg.query('SELECT current_database() AS name')).rows[0].name,'aacp_prod');
  const alive=(await pg.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1) AS alive',['zyon-retail-'+id.slice(0,16)])).rows[0].alive;
  const reconciled=await markInterruptedRetailImport(pg,{snapshotId:id,processAlive:alive});
  const s=(await pg.query('SELECT id,state,counts,error_code,updated_at FROM company_directory.company_snapshots WHERE id=$1',[id])).rows[0];assert.ok(s);
  const p=s.counts.progress??{},pointer=(await pg.query("SELECT snapshot_id FROM company_directory.active_snapshot WHERE id='national'")).rows[0];
  console.log(JSON.stringify({jobId:id,state:s.state,phase:p.phase??null,workerAlive:alive,reconciled,committedRecords:p.committedRecords??0,selectedCompanies:p.selectedCompanies??0,validatedFiles:p.validatedFiles??0,requiredFiles:p.requiredFiles??23,updatedAt:p.updatedAt??s.updated_at,errorCode:s.error_code,activeSnapshotId:pointer?.snapshot_id??null,coverage:s.counts.coverage??null}));
 }finally{await pg.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
