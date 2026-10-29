import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { WHATSAPP_CONFIG_REPOSITORY } from "./domain/ports/whatsapp-config-repository.port.js";
import { PrismaWhatsAppConfigRepository } from "./infrastructure/repositories/prisma-whatsapp-config.repository.js";

/**
 * Base module exposing only the per-merchant WhatsApp channel config repository
 * (Twilio/WABA credentials). No dependencies beyond the global Prisma client.
 *
 * Extracted so whatsapp-templates can read merchant credentials without
 * importing the full WhatsAppChannelModule — keeping the dependency graph
 * acyclic (no forwardRef):
 *   whatsapp-channel     → WhatsAppConfigModule
 *   whatsapp-templates   → WhatsAppConfigModule
 */
@Module({
  imports: [PersistenceModule],
  providers: [{ provide: WHATSAPP_CONFIG_REPOSITORY, useClass: PrismaWhatsAppConfigRepository }],
  exports: [WHATSAPP_CONFIG_REPOSITORY],
})
export class WhatsAppConfigModule {}
