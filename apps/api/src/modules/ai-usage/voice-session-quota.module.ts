import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { VoiceSessionQuotaService, VOICE_SESSION_QUOTA_CLOCK } from "./application/voice-session-quota.service.js";
import { VOICE_SESSION_QUOTA_REPOSITORY } from "./domain/ports/voice-session-quota.repository.port.js";
import { PrismaVoiceSessionQuotaRepository } from "./infrastructure/prisma-voice-session-quota.repository.js";

@Module({
  imports: [PersistenceModule, PaymentModule],
  providers: [
    PrismaVoiceSessionQuotaRepository,
    { provide: VOICE_SESSION_QUOTA_REPOSITORY, useExisting: PrismaVoiceSessionQuotaRepository },
    { provide: VOICE_SESSION_QUOTA_CLOCK, useValue: () => new Date() },
    VoiceSessionQuotaService,
  ],
  exports: [VoiceSessionQuotaService],
})
export class VoiceSessionQuotaModule {}