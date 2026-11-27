import type { FiscalRecipient } from "./fiscal-recipient.js";
export const FISCAL_POSTAL_LOOKUP = Symbol("FISCAL_POSTAL_LOOKUP");
export interface FiscalPostalLookupPort { lookup(postalCode: string): Promise<FiscalRecipient["address"] | null> }
