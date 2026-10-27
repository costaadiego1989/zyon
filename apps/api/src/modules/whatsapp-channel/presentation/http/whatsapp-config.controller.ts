import { Controller, Get, Post, Param, Body, UseGuards, HttpCode, Req, ForbiddenException, Query } from "@nestjs/common";
import type { Request } from "express";
import { IsBoolean, IsString, Matches, MaxLength, MinLength, IsIn, IsOptional } from "class-validator";
import { GetWhatsAppUsageUseCase, type WhatsAppUsagePeriod } from "../../application/use-cases/get-whatsapp-usage.use-case.js";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { ConfigureWhatsAppUseCase } from "../../application/use-cases/configure-whatsapp.use-case.js";

export class WhatsAppSignupDto {
  @IsString() @Matches(/^\d{5,40}$/) wabaId!: string;
  @IsString() @Matches(/^\d{5,40}$/) phoneNumberId!: string;
  @IsString() @MinLength(1) @MaxLength(4096) code!: string;
}
export class WhatsAppVerifyDto { @IsString() @Matches(/^\d{6}$/) code!: string; }
export class WhatsAppToggleDto { @IsBoolean() enabled!: boolean; }
export class WhatsAppUsageQueryDto { @IsOptional() @IsIn(["month", "7d", "30d"]) period?: WhatsAppUsagePeriod; }

@Controller("merchants/:merchantId/whatsapp")
@UseGuards(AuthGuard)
export class WhatsAppConfigController {
  constructor(private readonly configureWhatsApp: ConfigureWhatsAppUseCase, private readonly usage: GetWhatsAppUsageUseCase) {}
  private tenant(request: Request, merchantId: string) {
    if (currentUser(request as Request & { user?: unknown }).merchantId !== merchantId) {
      throw new ForbiddenException("merchant_scope_mismatch");
    }
    return merchantId;
  }
  @Get("onboarding")
  settings(@Req() request: Request, @Param("merchantId") merchantId: string) {
    this.tenant(request, merchantId);
    return this.configureWhatsApp.settings();
  }
  @Get("connection")
  getConnection(@Req() request: Request, @Param("merchantId") merchantId: string) {
    return this.configureWhatsApp.connection(this.tenant(request, merchantId));
  }
  @Get("usage")
  getUsage(@Req() request: Request, @Param("merchantId") merchantId: string, @Query() query: WhatsAppUsageQueryDto) {
    return this.usage.execute(this.tenant(request, merchantId), query.period);
  }
  @Post("meta/connect") @HttpCode(200)
  connectViaEmbeddedSignup(@Req() request: Request, @Param("merchantId") merchantId: string, @Body() body: WhatsAppSignupDto) {
    return this.configureWhatsApp.connectViaEmbeddedSignup({ ...body, merchantId: this.tenant(request, merchantId) });
  }
  @Post("twilio/connect") @HttpCode(200)
  connectTwilio(@Req() request: Request, @Param("merchantId") merchantId: string) {
    this.tenant(request, merchantId);
    return { status: "EMBEDDED_SIGNUP_REQUIRED" };
  }
  @Post("twilio/verify") @HttpCode(200)
  verifyOtp(@Req() request: Request, @Param("merchantId") merchantId: string, @Body() _body: WhatsAppVerifyDto) {
    this.tenant(request, merchantId);
    // Kept as a harmless compatibility response for older dashboard bundles.
    // Meta completes the OTP inside Embedded Signup; Zyon never handles it.
    return { status: "META_OTP_COMPLETED_IN_POPUP" };
  }
  @Post("refresh") @HttpCode(200)
  refresh(@Req() request: Request, @Param("merchantId") merchantId: string) {
    return this.configureWhatsApp.refresh(this.tenant(request, merchantId));
  }
  @Post("disconnect") @HttpCode(200)
  disconnect(@Req() request: Request, @Param("merchantId") merchantId: string) {
    return this.configureWhatsApp.disconnect(this.tenant(request, merchantId));
  }
  @Post("toggle") @HttpCode(200)
  toggle(@Req() request: Request, @Param("merchantId") merchantId: string, @Body() body: WhatsAppToggleDto) {
    return this.configureWhatsApp.setEnabled(this.tenant(request, merchantId), body.enabled);
  }
  @Post("test") @HttpCode(200)
  sendTest(@Req() request: Request, @Param("merchantId") merchantId: string) {
    this.tenant(request, merchantId);
    return { status: "INBOUND_TEST_REQUIRED" };
  }
}
