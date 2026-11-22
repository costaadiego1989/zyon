import assert from "node:assert/strict";
import { test } from "node:test";
import { guardProspectingImportBatch } from "../scripts/prospecting-storage-guard.mjs";
const GiB = 1024 ** 3;
function fixture({free=20*GiB, walFree=free, database=34*GiB, lines, denied=false}={}) {
  const rows = lines ?? ["Filesystem 1024-blocks Used Available Capacity Mounted on", ...[free,walFree].map((n,i)=>`/dev/volume${i} 47745772 134452 ${Math.floor(n/1024)} 1% /var/lib/postgresql/data`)];
  return { async query(sql) {
    if (sql.includes("FROM PROGRAM") && denied) throw Error("permission denied");
    if (sql.includes("SELECT line")) return {rows:rows.map(line=>({line}))};
    return {rows:[{bytes:String(database)}]};
  }};
}
test("production import blocks writes with a small database and an exhausted data or WAL volume", async()=>{
  for(const options of [{free:1024**2},{walFree:1024**2},{free:15*GiB+256*1024**2-1024},{database:35*GiB}]) {
    const persisted=[];
    await assert.rejects(()=>guardProspectingImportBatch(fixture(options),async()=>persisted.push("batch")),/production_directory_storage_limit/);
    assert.deepEqual(persisted,[]);
  }
});
test("production import refuses missing, malformed, wrong-quota and denied measurements before writing",async()=>{
  for(const options of [{lines:[]},{lines:["Filesystem", "garbled", "garbled"]},{lines:["Filesystem", "/dev/host 900000000 1 899999999 1% /", "/dev/host 900000000 1 899999999 1% /"]},{denied:true}]) {
    const persisted=[];
    await assert.rejects(()=>guardProspectingImportBatch(fixture(options),async()=>persisted.push("batch")),/production_storage_measurement_unavailable/);
    assert.deepEqual(persisted,[]);
  }
});
test("production import preserves the volume reserve and returns a committed batch at the exact boundary",async()=>{
  const persisted=[];
  const out=await guardProspectingImportBatch(fixture({free:15*GiB+256*1024**2}),async()=>{persisted.push("batch");return {committed:1000,replay:false};});
  assert.deepEqual(persisted,["batch"]);
  assert.deepEqual(out.result,{committed:1000,replay:false});
  assert.equal(out.storage.databaseBytes,String(34*GiB));
  assert.equal(out.storage.volumes.length,2);
  assert.equal(out.storage.volumes[0].availableBytes,String(15*GiB+256*1024**2));
  assert.ok(Number.isFinite(Date.parse(out.storage.measuredAt)));
});
