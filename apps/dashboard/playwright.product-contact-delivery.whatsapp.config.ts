import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
export default defineConfig({testDir:resolve(directory,'e2e-product-catalog'),testMatch:['product-contact-delivery.whatsapp.spec.ts'],
  fullyParallel:false,workers:1,retries:0,forbidOnly:true,timeout:60_000,globalTimeout:600_000,
  reporter:[['list'],[resolve(directory,'e2e/service-local-reporter.mjs')],
    ...(process.env.SERVICE_COMPANY_PROOF_REPORT?[['json',{outputFile:process.env.SERVICE_COMPANY_PROOF_REPORT}]as[string,{outputFile:string}]]:[])],
  outputDir:resolve(directory,'../../.specs/features/whatsapp-service-booking-business-rag/captures/delivery-whatsapp-artifacts'),
  use:{browserName:'chromium',channel:'msedge',headless:true,viewport:{width:1440,height:1000},serviceWorkers:'block',
    trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:10_000,navigationTimeout:30_000},
  projects:[{name:'mobile',use:{viewport:{width:390,height:844}}}],
});