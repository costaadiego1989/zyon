import {defineConfig} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import shared from './playwright.service-local.config.ts';

const root=dirname(fileURLToPath(import.meta.url));
export default defineConfig({...shared,use:{...shared.use,trace:'on'},testMatch:['support-notification-settings.spec.ts'],globalSetup:resolve(root,'e2e/service-support-notification-setup.mjs')});
