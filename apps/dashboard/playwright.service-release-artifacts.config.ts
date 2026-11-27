import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  testDir:resolve(root,'e2e'),testMatch:['service-standalone-widget-release.spec.ts'],fullyParallel:false,workers:1,retries:0,forbidOnly:true,
  timeout:60_000,globalTimeout:600_000,
  reporter:[['list'],[resolve(root,'e2e/service-local-reporter.mjs')],...(process.env.SERVICE_RELEASE_STANDALONE_REPORT?[['json',{outputFile:process.env.SERVICE_RELEASE_STANDALONE_REPORT}] as [string,{outputFile:string}]]:[])],
  outputDir:resolve(root,'../../.specs/features/whatsapp-service-booking-business-rag/captures/standalone-widget-release'),
  use:{browserName:'chromium',channel:'msedge',headless:true,viewport:{width:1440,height:1000},serviceWorkers:'block',
    trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:10_000,navigationTimeout:30_000},
});
