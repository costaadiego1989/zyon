import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { RegisterBuyerUseCase } from "../../application/use-cases/register-buyer.use-case.js";
import { LoginBuyerUseCase } from "../../application/use-cases/login-buyer.use-case.js";
import { GetBuyerProfileUseCase } from "../../application/use-cases/get-buyer-profile.use-case.js";
import { UpdateBuyerProfileUseCase } from "../../application/use-cases/update-buyer-profile.use-case.js";
import { ChangeBuyerPasswordUseCase } from "../../application/use-cases/change-buyer-password.use-case.js";
import { GetBuyerPurchasesUseCase } from "../../application/use-cases/get-buyer-purchases.use-case.js";
import { GetBuyerSummaryUseCase } from "../../application/use-cases/get-buyer-summary.use-case.js";
import { SendBuyerPhoneCodeUseCase } from "../../application/use-cases/send-buyer-phone-code.use-case.js";
import { VerifyBuyerPhoneCodeUseCase } from "../../application/use-cases/verify-buyer-phone-code.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

@Controller("buyer")
export class BuyerAccountController {
  constructor(
    private readonly registerBuyer: RegisterBuyerUseCase,
    private readonly loginBuyer: LoginBuyerUseCase,
    private readonly getProfile: GetBuyerProfileUseCase,
    private readonly updateProfile: UpdateBuyerProfileUseCase,
    private readonly changePassword: ChangeBuyerPasswordUseCase,
    private readonly getPurchases: GetBuyerPurchasesUseCase,
    private readonly getSummary: GetBuyerSummaryUseCase,
    private readonly sendPhoneCode: SendBuyerPhoneCodeUseCase,
    private readonly verifyPhoneCode: VerifyBuyerPhoneCodeUseCase
  ) {}

  @Post("register")
  async register(
    @Body() body: { email: string; password: string; displayName: string; phone?: string }
  ) {
    return this.registerBuyer.execute(body);
  }

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    return this.loginBuyer.execute(body);
  }

  @Get("me")
  @UseGuards(BuyerJwtAuthGuard)
  async getMe(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.getProfile.execute(buyer.globalUserId);
  }

  @Patch("me/profile")
  @UseGuards(BuyerJwtAuthGuard)
  async patchProfile(
    @Req() req: { user?: unknown },
    @Body() body: { displayName?: string; phone?: string }
  ) {
    const buyer = currentBuyer(req);
    return this.updateProfile.execute({ globalUserId: buyer.globalUserId, ...body });
  }

  @Patch("me/password")
  @UseGuards(BuyerJwtAuthGuard)
  async patchPassword(
    @Req() req: { user?: unknown },
    @Body() body: { currentPassword: string; newPassword: string }
  ) {
    const buyer = currentBuyer(req);
    await this.changePassword.execute({ globalUserId: buyer.globalUserId, ...body });
    return { success: true };
  }

  @Get("me/purchases")
  @UseGuards(BuyerJwtAuthGuard)
  async getPurchaseHistory(
    @Req() req: { user?: unknown },
    @Query("merchant_id") merchantId?: string,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string
  ) {
    const buyer = currentBuyer(req);
    return this.getPurchases.execute({
      globalUserId: buyer.globalUserId,
      merchantId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get("me/summary")
  @UseGuards(BuyerJwtAuthGuard)
  async summary(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.getSummary.execute(buyer.globalUserId);
  }

  @Post("phone/send")
  async sendCode(@Body() body: { phone: string }) {
    return this.sendPhoneCode.execute(body);
  }

  @Post("phone/verify")
  async verifyCode(@Body() body: { phone: string; code: string }) {
    return this.verifyPhoneCode.execute(body);
  }
}
