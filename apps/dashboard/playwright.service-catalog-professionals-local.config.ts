import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import shared from './playwright.service-local.config.ts';

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({...shared,
  testMatch:['service-catalog-professionals.spec.ts','service-catalog-business-mode.spec.ts','service-catalog-toggles.spec.ts'],
  globalSetup:resolve(root,'e2e/service-catalog-professionals-setup.mjs')});
