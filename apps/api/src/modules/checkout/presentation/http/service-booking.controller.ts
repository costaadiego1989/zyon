import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { EmbedAuthGuard, readTrustedStorefrontOrigin } from "../../../embed/presentation/http/embed-auth.guard.js";
import { RequireEmbedScope } from "../../../embed/presentation/http/embed-scope.decorator.js";
import type { EmbedTokenClaims } from "../../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { ResolveEmbedBuyerService } from "../../../embed/application/resolve-embed-buyer.service.js";
import { ServiceBookingService, type ServiceBookingScope } from "../../application/service-booking.service.js";
import type { TrustedCheckoutBuyer } from "../../application/services/trusted-checkout-buyer.js";

const identifier = z.string().min(1).max(191).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const version = z.number().int().min(1).max(2_147_483_647);
const offer = { productId: identifier, variantId: identifier };
const professional = { ...offer, professionalId: identifier };
const selection = z.object({ ...professional, professionalVersion: version, policyVersion: version, date,
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(80),
  durationMinutes: z.number().int().min(5).max(480), priceInCents: z.number().int().min(0).max(2_147_483_647),
  currency: z.string().regex(/^[A-Z]{3}$/), slotId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const selected = z.object({ selection }).strict();
const prepared = selected.extend({ parent_cart_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("service_booking_input_invalid");
  return result.data;
}
type BookingRequest = { headers?: Record<string, string | string[] | undefined>; embedClaims?: EmbedTokenClaims };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Caller has already verified both signed credentials and resolved this buyer. */
export function serviceBookingScopeFromVerifiedBuyer(claims: EmbedTokenClaims, headers: NonNullable<BookingRequest["headers"]>,
  buyer: TrustedCheckoutBuyer, token: unknown): ServiceBookingScope {
  if (!claims.scopes?.includes("checkout:start") || claims.nonce === "dev_bypass" || !claims.allowedOrigin
    || claims.cartRef !== undefined || claims.whatsappCheckoutSessionId !== undefined)
    throw new ForbiddenException("service_booking_capability_invalid");
  const supplied = readTrustedStorefrontOrigin(headers) ?? first(headers.origin ?? headers.Origin ?? headers.referer ?? headers.Referer);
  let origin: string;
  try { origin = new URL(supplied ?? "").origin; } catch { throw new ForbiddenException("service_booking_capability_invalid"); }
  if (origin !== claims.allowedOrigin) throw new ForbiddenException("service_booking_capability_invalid");
  if (typeof token !== "string") throw new UnauthorizedException("embed_buyer_token_invalid");
  const jwt = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { exp: number };
  const expiresAtUnix = Math.min(claims.expiresAtUnix, jwt.exp);
  if (!Number.isSafeInteger(expiresAtUnix) || expiresAtUnix <= Math.floor(Date.now() / 1000))
    throw new UnauthorizedException("embed_session_token_expired");
  return Object.freeze({ merchantId: claims.merchantId, sessionId: embedCheckoutSessionId(claims),
    ...(claims.storefrontCartRef ? { cartRef: claims.storefrontCartRef } : {}), allowedOrigin: origin,
    expiresAtUnix, buyer: structuredClone(buyer) });
}

@UseGuards(EmbedAuthGuard)
@Controller("embed/service-booking")
export class ServiceBookingController {
  constructor(private readonly booking: ServiceBookingService, private readonly resolveBuyer: ResolveEmbedBuyerService) {}

  private async scope(request: BookingRequest): Promise<ServiceBookingScope> {
    const claims = request.embedClaims, headers = request.headers ?? {};
    if (!claims || !claims.scopes?.includes("checkout:start") || claims.nonce === "dev_bypass" || !claims.allowedOrigin
      || claims.cartRef !== undefined || claims.whatsappCheckoutSessionId !== undefined)
      throw new ForbiddenException("service_booking_capability_invalid");
    const supplied = readTrustedStorefrontOrigin(headers) ?? first(headers.origin ?? headers.Origin ?? headers.referer ?? headers.Referer);
    let origin: string;
    try { origin = new URL(supplied ?? "").origin; } catch { throw new ForbiddenException("service_booking_capability_invalid"); }
    if (origin !== claims.allowedOrigin) throw new ForbiddenException("service_booking_capability_invalid");
    const token = headers["x-buyer-access-token"] ?? headers["X-Buyer-Access-Token"];
    const buyer = await this.resolveBuyer.resolve(claims.merchantId, token);
    if (!buyer || typeof token !== "string") throw new UnauthorizedException("embed_buyer_token_invalid");
    return serviceBookingScopeFromVerifiedBuyer(claims, headers, buyer, token);
  }

  @Get("professionals")
  @Header("Cache-Control", "no-store")
  @RequireEmbedScope("checkout:start")
  async professionals(@Req() request: BookingRequest, @Query() query: unknown) {
    const input = parse(z.object(offer).strict(), query);
    return this.booking.professionals(await this.scope(request), input);
  }
  @Get("dates")
  @Header("Cache-Control", "no-store")
  @RequireEmbedScope("checkout:start")
  async dates(@Req() request: BookingRequest, @Query() query: unknown) {
    const input = parse(z.object({ ...professional, fromDate: date, toDate: date }).strict(), query);
    return this.booking.dates(await this.scope(request), input);
  }
  @Get("slots")
  @Header("Cache-Control", "no-store")
  @RequireEmbedScope("checkout:start")
  async slots(@Req() request: BookingRequest, @Query() query: unknown) {
    const input = parse(z.object({ ...professional, date }).strict(), query);
    return this.booking.slots(await this.scope(request), input);
  }
  @Post("select")
  @Header("Cache-Control", "no-store")
  @RequireEmbedScope("checkout:start")
  async select(@Req() request: BookingRequest, @Body() body: unknown) {
    const input = parse(selected, body);
    return this.booking.select(await this.scope(request), input);
  }
  @Post("prepare")
  @Header("Cache-Control", "no-store")
  @RequireEmbedScope("checkout:start")
  async prepare(@Req() request: BookingRequest, @Body() body: unknown) {
    const input = parse(prepared, body);
    return this.booking.prepare(await this.scope(request), input);
  }
}
