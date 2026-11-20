import type { FiscalIntentRecord } from "./fiscal-repository.port.js";
/** A claimed write processor or a separate read-only recovery processor. */
export interface FiscalClaimProcessor { run(claim: FiscalIntentRecord): Promise<void> }
