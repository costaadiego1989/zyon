import type { MetaAdsFundingSnapshot } from '@zyon/shared-types';
import type { MetaAccess } from './types.js';

export interface MetaFundingPort { read(access: MetaAccess): Promise<MetaAdsFundingSnapshot>; }
/** Server-reviewed route bound to a scoped account identity; never a client/model URL. */
export interface VerifiedMetaPaymentDestination { accountId: string; url: string; verifiedAt: string; }
export type MetaPaymentDestinationResolver = (accountId: string) => Promise<VerifiedMetaPaymentDestination | null>;
