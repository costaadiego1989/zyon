import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { PrismaWhatsAppHandoffRepository } from "./infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { WhatsAppTurnContext } from "./domain/services/whatsapp-turn-context.js";

@Module({ imports: [PersistenceModule], providers: [PrismaWhatsAppHandoffRepository, WhatsAppTurnContext], exports: [PrismaWhatsAppHandoffRepository, WhatsAppTurnContext] })
export class WhatsAppHandoffModule {}
