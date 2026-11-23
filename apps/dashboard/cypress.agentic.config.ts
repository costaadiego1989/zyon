import { defineConfig } from 'cypress';
import { fileURLToPath } from 'node:url';

const artifact=(name:string)=>fileURLToPath(new URL(`../../.specs/features/agentic-dashboard-assistant/cypress-results/${name}`,import.meta.url));
export default defineConfig({
  viewportWidth:1440,
  viewportHeight:900,
  defaultCommandTimeout:45000,
  requestTimeout:15000,
  responseTimeout:30000,
  pageLoadTimeout:120000,
  retries:0,
  video:false,
  numTestsKeptInMemory:0,
  screenshotOnRunFailure:true,
  screenshotsFolder:artifact('screenshots'),
  downloadsFolder:artifact('downloads'),
  e2e:{
    baseUrl:'http://127.0.0.1:5179',
    specPattern:'cypress/e2e/agentic/**/*.cy.ts',
    supportFile:false,
    testIsolation:true,
  },
});
