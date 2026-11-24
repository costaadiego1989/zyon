import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import shared from './playwright.service-local.config.ts';

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({...shared,
  testMatch:['service-availability.spec.ts','service-fixed-time-zone.spec.ts','service-catalog-business-mode.spec.ts','service-catalog-toggles.spec.ts','service-catalog-professionals.spec.ts','service-attendance-shell.spec.ts'],
  globalSetup:resolve(root,'e2e/service-availability-setup.mjs')});
