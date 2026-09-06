import type { RecoveryTemplateEdit } from "../recovery-template-content.js";
import type { WhatsAppTemplateRecord } from "./whatsapp-template-repository.port.js";

export const RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY = Symbol("RecoveryTemplateLifecycleRepository");
export const RECOVERY_TEMPLATE_INITIALIZER = Symbol("RecoveryTemplateInitializer");
export interface RecoveryTemplateInitializer { ensure(merchantId: string): Promise<void> }
export interface RecoveryLifecycleRecord extends WhatsAppTemplateRecord {
  metaRevision: number;
  metaNextCheckAt: Date | null;
  metaLastCheckedAt: Date | null;
  metaClaimToken?: string | null;
}
export interface RecoveryLifecycleRepository {
  ensure(merchantId: string): Promise<void>;
  read(merchantId: string): Promise<{ email: RecoveryLifecycleRecord; whatsapp: RecoveryLifecycleRecord }>;
  save(merchantId: string, input: RecoveryTemplateEdit): Promise<void>;
  due(now: Date): Promise<RecoveryLifecycleRecord[]>;
  claim(record: RecoveryLifecycleRecord, now: Date, submitting: boolean): Promise<boolean>;
  complete(record: RecoveryLifecycleRecord, patch: {
    status: string; contentSid?: string | null; reason?: string | null; checkedAt?: Date; nextCheckAt: Date | null;
  }, submitting: boolean): Promise<void>;
  seedMerchantPage(afterId?: string): Promise<string | undefined>;
}
