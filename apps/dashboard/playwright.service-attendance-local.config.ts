import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import shared from './playwright.service-local.config.ts';

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({...shared,testMatch:['service-attendance-shell.spec.ts'],globalSetup:resolve(root,'e2e/service-attendance-setup.mjs')});
