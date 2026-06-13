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
import type { CustomerAddress } from "@aacp/shared-types";
import { RegisterBuyerUseCase } from "../../application/use-cases/register-buyer.use-case.js";
import { LoginBuyerUseCase } from "../../application/use-cases/login-buyer.use-case.js";
import { LoginBuyerFromSessionUseCase } from "../../application/use-cases/login-buyer-from-session.use-case.js";
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
    private readonly loginFromSession: LoginBuyerFromSessionUseCase,
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
      cpf: account.cpf,
      address: account.address
    };
  }

  @Patch("me/profile")
  @UseGuards(BuyerJwtAuthGuard)
  async patchProfile(
    @Req() req: { user?: unknown },
    @Body() body: { display_name?: string; phone?: string; address?: CustomerAddress }
  ) {
    const buyer = currentBuyer(req);
    const updated = await this.updateProfile.execute({
      globalUserId: buyer.globalUserId,
      displayName: body.display_name,
      phone: body.phone,
      address: body.address
    });
    return {
      global_user_id: updated.globalUserId,
      display_name: updated.displayName,
      email: updated.email,
      phone: updated.phone,
      cpf: updated.cpf,
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
      currency: "BRL"
    };
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

function purchaseItems(value: unknown): Array<{
  sku?: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url?: string | null;
  variant?: string | null;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Record<string, unknown>;
      const name = stringValue(source.name ?? source.title);
      const quantity = numberValue(source.quantity, 1);
      const unitPrice = numberValue(source.unit_price ?? source.unitPrice ?? source.price, 0);
      const lineTotal = numberValue(source.line_total ?? source.lineTotal, unitPrice * quantity);
      if (!name) return null;
      return {
        sku: stringValue(source.sku) || undefined,
        name,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        image_url: stringValue(source.image_url ?? source.imageUrl) || null,
        variant: stringValue(source.variant) || null
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
