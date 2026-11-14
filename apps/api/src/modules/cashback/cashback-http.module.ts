import { forwardRef, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module.js";
import { BuyerAccountModule } from "../buyer-account/buyer-account.module.js";
import { EmbedModule } from "../embed/embed.module.js";
import { CashbackCoreModule } from "./cashback.module.js";
import { CashbackBuyerController, CashbackEmbedController, CashbackMerchantController } from "./presentation/cashback.controllers.js";
import { CashbackErrorFilter } from "./presentation/cashback-error.filter.js";

@Module({ imports: [CashbackCoreModule, AuthModule, forwardRef(() => BuyerAccountModule), forwardRef(() => EmbedModule)], controllers: [CashbackMerchantController, CashbackBuyerController, CashbackEmbedController], providers: [{ provide: APP_FILTER, useClass: CashbackErrorFilter }] })
export class CashbackHttpModule {}
