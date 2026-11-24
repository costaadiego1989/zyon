import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import shared from './playwright.service-local.config.ts';

const directory=dirname(fileURLToPath(import.meta.url));
export default defineConfig({...shared,
 testMatch:['service-overview-journeys.spec.ts'],
 globalSetup:resolve(directory,'e2e/service-overview-setup.ts'),
 // Preserve original 60s/600s, one worker, zero retries and strict local origin.
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
});
