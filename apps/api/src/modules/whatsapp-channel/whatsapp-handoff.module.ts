import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { PrismaWhatsAppHandoffRepository } from "./infrastructure/repositories/prisma-whatsapp-handoff.repository.js";

@Module({ imports: [PersistenceModule], providers: [PrismaWhatsAppHandoffRepository], exports: [PrismaWhatsAppHandoffRepository] })
export class WhatsAppHandoffModule {}
