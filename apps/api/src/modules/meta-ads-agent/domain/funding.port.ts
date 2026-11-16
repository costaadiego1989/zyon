import type { MetaAdsFundingSnapshot } from '@zyon/shared-types';
import type { MetaAccess } from './types.js';

export interface MetaFundingPort { read(access: MetaAccess): Promise<MetaAdsFundingSnapshot>; }
/** Supplied only by server configuration after navigation was verified for that account. */
export interface VerifiedMetaPaymentDestination { accountId: string; url: string; verifiedAt: string; }
export type MetaPaymentDestinationResolver = (accountId: string) => Promise<VerifiedMetaPaymentDestination | null>;
