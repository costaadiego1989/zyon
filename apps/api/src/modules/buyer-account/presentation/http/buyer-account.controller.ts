import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Optional,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Ip,
} from "@nestjs/common";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import type { CustomerAddress } from "@zyon/shared-types";
import { RegisterBuyerUserUseCase } from "../../../self-checkout/application/use-cases/register-buyer-user.use-case.js";
import { RegisterBuyerWithRateLimitUseCase } from "../../application/use-cases/register-buyer-with-rate-limit.use-case.js";
import { LoginBuyerUseCase } from "../../application/use-cases/login-buyer.use-case.js";
import { LoginBuyerFromSessionUseCase } from "../../application/use-cases/login-buyer-from-session.use-case.js";
import { GetBuyerProfileUseCase } from "../../application/use-cases/get-buyer-profile.use-case.js";
import { UpdateBuyerProfileUseCase } from "../../application/use-cases/update-buyer-profile.use-case.js";
import { ChangeBuyerPasswordUseCase } from "../../application/use-cases/change-buyer-password.use-case.js";
import { GetBuyerPurchasesUseCase } from "../../application/use-cases/get-buyer-purchases.use-case.js";
import { GetBuyerSummaryUseCase } from "../../application/use-cases/get-buyer-summary.use-case.js";
import { GetBuyerLoyaltyUseCase } from "../../application/use-cases/get-buyer-loyalty.use-case.js";
import { SendBuyerPhoneCodeUseCase } from "../../application/use-cases/send-buyer-phone-code.use-case.js";
import { VerifyBuyerPhoneCodeUseCase } from "../../application/use-cases/verify-buyer-phone-code.use-case.js";
import { SendBuyerEmailCodeUseCase } from "../../application/use-cases/send-buyer-email-code.use-case.js";
import { VerifyBuyerEmailCodeUseCase } from "../../application/use-cases/verify-buyer-email-code.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import { purchaseItems } from "./purchase.transformer.js";

@Controller("buyer")
export class BuyerAccountController {
  constructor(
    private readonly registerBuyerWithRateLimit: RegisterBuyerWithRateLimitUseCase,
    private readonly loginBuyer: LoginBuyerUseCase,
    private readonly loginFromSession: LoginBuyerFromSessionUseCase,
    private readonly getProfile: GetBuyerProfileUseCase,
    private readonly updateProfile: UpdateBuyerProfileUseCase,
    private readonly changePassword: ChangeBuyerPasswordUseCase,
    private readonly getPurchases: GetBuyerPurchasesUseCase,
    private readonly getSummary: GetBuyerSummaryUseCase,
    private readonly getLoyalty: GetBuyerLoyaltyUseCase,
    private readonly sendPhoneCode: SendBuyerPhoneCodeUseCase,
    private readonly verifyPhoneCode: VerifyBuyerPhoneCodeUseCase,
    private readonly sendEmailCode: SendBuyerEmailCodeUseCase,
    private readonly verifyEmailCode: VerifyBuyerEmailCodeUseCase,
    @Optional() private readonly registerBuyerWallet?: RegisterBuyerUserUseCase,
  ) {}

  private readonly logger = new Logger(BuyerAccountController.name);

  @Post("register")
  async register(
    @Body()
    body: {
      email: string;
      password?: string;
      displayName?: string;
      name?: string;
      phone?: string;
      cpf?: string;
      address?: CustomerAddress;
      dateOfBirth?: string;
      gender?: string;
      merchantId?: string;
    },
    @Ip() ip: string
  ) {
    const displayName = (body.displayName ?? body.name ?? "").trim();
    const missing: string[] = [];

    if (!body.email?.trim()) missing.push("email");
    if (!displayName || displayName.split(/\s+/).length < 2) missing.push("name");
    if (!body.phone?.replace(/\D/g, "")) missing.push("phone");
    if (!body.cpf?.replace(/\D/g, "")) missing.push("cpf");
    const addr = body.address;
    if (!addr || !addr.zip || !addr.number || !addr.street || !addr.city || !addr.state) {
      missing.push("address");
    }
    if (missing.length > 0) {
      throw new BadRequestException(`missing_required_fields: ${missing.join(", ")}`);
    }

    const result = await this.registerBuyerWithRateLimit.execute(
      {
        email: body.email,
        password: body.password,
        displayName,
        phone: body.phone,
        cpf: body.cpf,
        address: body.address,
        dateOfBirth: parseDateOfBirth(body.dateOfBirth),
        gender: normalizeGender(body.gender),
      },
      ip || "unknown"
    );

    await this.provisionWalletBestEffort({ ...body, displayName, password: body.password ?? "" });

    return result;
  }

  private async provisionWalletBestEffort(body: {
    email: string;
    password: string;
    displayName: string;
    merchantId?: string;
  }): Promise<void> {
    if (!this.registerBuyerWallet) return;
    if (!body.merchantId) {
      this.logger.warn("wallet provisioning skipped: no merchant_id");
      return;
    }
    try {
      const passwordHash = await hashWalletPassword(body.password);
      await this.registerBuyerWallet.execute({
        merchant_id: body.merchantId,
        email: body.email,
        password: passwordHash,
        display_name: body.displayName,
      });
    } catch (error) {
      this.logger.warn(
        `wallet provisioning failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    return this.loginBuyer.execute(body);
  }

  @Post("login-from-session")
  async loginFromCheckoutSession(
    @Body() body: { session_id: string; merchant_id: string }
  ) {
    const result = await this.loginFromSession.execute(body);
    return {
      global_user_id: result.globalUserId,
      email: result.email,
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn
    };
  }

  @Get("me")
  @UseGuards(BuyerJwtAuthGuard)
  async getMe(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const account = await this.getProfile.execute(buyer.globalUserId);
    return {
      global_user_id: account.globalUserId,
      display_name: account.displayName,
      email: account.email,
      phone: account.phone,
      cpf: account.cpf ? account.cpf.replace(/^(\d{3})\d{3}\d{3}(\d{2})$/, "$1.***.***-$2") : null,
      address: account.address
    };
  }

  @Patch("me/profile")
  @UseGuards(BuyerJwtAuthGuard)
  async patchProfile(
    @Req() req: { user?: unknown },
    @Body()
    body: {
      display_name?: string;
      phone?: string;
      email?: string;
      cpf?: string;
      date_of_birth?: string;
      gender?: string;
      address?: CustomerAddress;
    }
  ) {
    const buyer = currentBuyer(req);
    const updated = await this.updateProfile.execute({
      globalUserId: buyer.globalUserId,
      displayName: body.display_name,
      phone: body.phone,
      email: body.email,
      cpf: body.cpf,
      dateOfBirth: parseDateOfBirth(body.date_of_birth),
      gender: normalizeGender(body.gender),
      address: body.address
    });
    return {
      global_user_id: updated.globalUserId,
      display_name: updated.displayName,
      email: updated.email,
      phone: updated.phone,
      cpf: updated.cpf ? updated.cpf.replace(/^(\d{3})\d{3}\d{3}(\d{2})$/, "$1.***.***-$2") : null,
      date_of_birth: updated.dateOfBirth ? updated.dateOfBirth.toISOString().slice(0, 10) : null,
      gender: updated.gender ?? null,
      address: updated.address
    };
  }

  @Patch("me/password")
  @UseGuards(BuyerJwtAuthGuard)
  async patchPassword(
    @Req() req: { user?: unknown },
    @Body() body: { current_password: string; new_password: string }
  ) {
    const buyer = currentBuyer(req);
    await this.changePassword.execute({
      globalUserId: buyer.globalUserId,
      currentPassword: body.current_password,
      newPassword: body.new_password
    });
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
    const page = await this.getPurchases.execute({
      globalUserId: buyer.globalUserId,
      merchantId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
    return {
      items: page.records.map((r) => ({
        id: r.id,
        order_id: r.orderId,
        merchant_name: r.merchantName,
        tracking_code: r.trackingCode ?? null,
        tracking_status: r.trackingStatus ?? null,
        tracking_url: r.trackingUrl ?? null,
        carrier: r.carrier ?? null,
        tracking_events: r.trackingEvents.map((event) => ({
          status: event.status,
          description: event.description,
          location: event.location ?? null,
          occurred_at: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : String(event.occurredAt)
        })),
        total: r.totalAmount,
        discount_amount: r.discountAmount,
        items: purchaseItems(r.items),
        items_count: purchaseItems(r.items).reduce((sum, item) => sum + item.quantity, 0),
        currency: r.currency,
        payment_method: r.paymentMethod ?? null,
        created_at: r.completedAt instanceof Date ? r.completedAt.toISOString() : String(r.completedAt)
      })),
      next_cursor: page.nextCursor
    };
  }

  @Get("me/summary")
  @UseGuards(BuyerJwtAuthGuard)
  async summary(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const data = await this.getSummary.execute(buyer.globalUserId);
    return {
      orders_count: data.stats.totalOrders,
      total_spent: data.stats.totalSpent,
      average_ticket: data.stats.averageTicket,
      currency: "BRL"
    };
  }

  @Get("me/loyalty")
  @UseGuards(BuyerJwtAuthGuard)
  async loyalty(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const data = await this.getLoyalty.execute(buyer.globalUserId);
    return {
      total_orders: data.totalOrders,
      total_spent_cents: data.totalSpentCents,
      avg_order_value_cents: data.avgOrderValueCents,
      top_categories: data.topCategories,
      preferred_brands: data.preferredBrands,
      discount_sensitivity: data.discountSensitivity,
      last_purchase_at: data.lastPurchaseAt instanceof Date ? data.lastPurchaseAt.toISOString() : data.lastPurchaseAt,
    };
  }

  @Post("phone/send")
  async sendCode(@Body() body: { phone: string; merchant_name?: string; buyer_name?: string; fallback_email?: string }) {
    return this.sendPhoneCode.execute({
      phone: body.phone,
      merchantName: body.merchant_name,
      buyerName: body.buyer_name,
      fallbackEmail: body.fallback_email,
    });
  }

  @Post("phone/verify")
  async verifyCode(@Body() body: { phone: string; code: string }) {
    return this.verifyPhoneCode.execute(body);
  }

  @Post("email/send")
  async handleSendEmailCode(@Body() body: { email: string }) {
    return this.sendEmailCode.execute(body);
  }

  @Post("email/verify")
  async handleVerifyEmailCode(@Body() body: { email: string; code: string }) {
    return this.verifyEmailCode.execute(body);
  }
}

const scryptAsync = promisify(scrypt);
const WALLET_KEY_LEN = 64;

async function hashWalletPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = (await scryptAsync(password, salt, WALLET_KEY_LEN)) as Buffer;
  return `scrypt:${salt}:${key.toString("base64url")}`;
}

const ALLOWED_GENDERS = ["feminino", "masculino", "nao_binario", "outro", "prefiro_nao_informar"] as const;

function parseDateOfBirth(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeGender(value?: string): string | undefined {
  if (!value) return undefined;
  return (ALLOWED_GENDERS as readonly string[]).includes(value) ? value : undefined;
}
