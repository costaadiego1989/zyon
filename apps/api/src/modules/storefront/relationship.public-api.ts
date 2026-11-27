import { Inject, Injectable, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";

/** Authoritative cart facts, including native WhatsApp shopping before checkout. */
@Injectable()
export class StorefrontRelationshipReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}
  async shopping(merchantId:string,conversationId:string):Promise<boolean> {
    const cart=await this.db.storefrontCart.findUnique({where:{merchantId_sessionId:{merchantId,sessionId:conversationId}},
      select:{items:true,expiresAt:true}});
    return !!cart && cart.expiresAt.getTime()>Date.now() && Array.isArray(cart.items) && cart.items.length>0;
  }
}
@Module({providers:[StorefrontRelationshipReader],exports:[StorefrontRelationshipReader]})
export class StorefrontRelationshipModule {}
