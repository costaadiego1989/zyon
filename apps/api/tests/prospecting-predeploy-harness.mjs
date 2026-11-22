import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { prospectingMigrationPlan } from "../scripts/prospecting-migration-plan.mjs";
const url = new URL("../scripts/predeploy-migrations.mjs", import.meta.url);
const commands = [];
const environment = {
  DATABASE_URL:"postgresql://fixture:fixture@127.0.0.1:15438/prospecting_test",
  PROSPECTING_ENABLED:process.argv[2],
  PROSPECTING_DIRECTORY_DATABASE_URL:"postgresql://fixture:fixture@127.0.0.1:15438/prospecting_test?schema=company_directory",
};
const context = vm.createContext({process:{env:environment,execPath:process.execPath},URL,console:{log(){},info(){}}});
function dependency(values) {
  return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});
}
class FixtureClient {
  async connect() {} async end() {}
  async query(sql) {
    if (sql.includes("table_count")) return {rows:[{has_migrations:false,has_merchants:false,table_count:0}]};
    return {rows:[{has_billing_subscriptions:true,has_provider_cancellation_scheduled_at:true,has_erp_sync_jobs:true,has_erp_product_mappings:true,has_erp_webhook_routes:true}]};
  }
}
const dependencies = {
  "node:child_process":dependency({spawnSync(_node,args){commands.push(args.slice(1));return {status:0};}}),
  "node:url":dependency({fileURLToPath}),
  "pg":dependency({default:{Client:FixtureClient}}),
  "./revenue-foundation-repair.mjs":dependency({repairRevenueFoundationFailure:async()=>false,revenueFoundationMigration:"fixture"}),
  "./prospecting-migration-plan.mjs":dependency({prospectingMigrationPlan}),
};
const module = new vm.SourceTextModule(readFileSync(url,"utf8"),{context,identifier:url.href,initializeImportMeta(meta){meta.url=url.href;}});
await module.link(specifier=>{if(!dependencies[specifier])throw Error("Unexpected predeploy dependency: "+specifier);return dependencies[specifier];});
await module.evaluate();
console.log(JSON.stringify(commands));
