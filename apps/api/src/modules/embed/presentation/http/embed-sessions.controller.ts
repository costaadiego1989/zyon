import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Optional,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { currentEmbedIssuer, EmbedSessionIssuerGuard } from "./embed-session-issuer.guard.js";
import { ListInstallationsUseCase, ResolveInstallationForEmbedUseCase } from "../../../installations/application/installation.use-cases.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";

class IssueEmbedSessionDto {
  @ApiPropertyOptional({ type: String, example: "cm123installation" })
  @IsOptional()
  @IsString()
  installation_id?: string;

  @ApiPropertyOptional({ type: Number, minimum: 60, maximum: 86400, example: 900 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  ttl_seconds?: number;

  @ApiPropertyOptional({ type: String, example: "https://checkout.example.com" })
  @IsOptional()
  @IsString()
  allowed_origin?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["checkout:start", "checkout:chat"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ type: String, example: "cart_123" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cart_ref?: string;
}

@ApiTags("Embed sessions")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(EmbedSessionIssuerGuard)
@Controller(["embed-sessions", "embed/sessions"])
export class EmbedSessionsController {
  constructor(
    private readonly issue: IssueEmbedSessionUseCase,
    private readonly resolveInstallation: ResolveInstallationForEmbedUseCase,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Optional() private readonly listInstallations?: ListInstallationsUseCase,
  ) {}

  @Post()
  @Idempotent()
  @ApiOperation({
    summary: "Issue an embed session token",
    description:
      "Create a short-lived embed session token for use with the `<zyon-checkout-agent>` web component. " +
      "The token encodes the merchant context, allowed scopes, and optional widget binding (installation). " +
      "Pass the returned `token` value as the `session-token` attribute on the web component. " +
      "Default TTL is 900 seconds (15 min); configurable between 60s and 86400s. " +
      "When `allowed_origin` is provided, the token will only be accepted from matching origins. " +
      "If `installation_id` is given, the session inherits that installation's environment and widget version.",
  })
  @ApiBody({ type: IssueEmbedSessionDto })
  @ApiResponse({
    status: 201,
    description: "Embed session created successfully",
    schema: {
      type: "object",
      properties: {
        token: { type: "string", description: "JWT embed session token to set on <zyon-checkout-agent session-token=\"...\">" },
        expires_at: { type: "string", format: "date-time", description: "Token expiration timestamp" },
        merchant_id: { type: "string", example: "cm123merchant" },
        installation_id: { type: "string", nullable: true, description: "Resolved installation ID if provided" },
        scopes: { type: "array", items: { type: "string" }, example: ["checkout:start", "checkout:chat"] },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Validation error: invalid scopes, origin, or TTL out of range. Also returned when merchant_id is passed in body (must be derived from credentials).",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized. Missing or invalid service API key or console session cookie.",
  })
  async issueSession(
    @Req() request: unknown,
    @Body() body: IssueEmbedSessionDto,
  ) {
    if ("merchant_id" in (body as object)) {
      throw new BadRequestException("merchant_id_is_credential_derived");
    }
    const issuer = currentEmbedIssuer(request as never);
    let ttl = typeof body?.ttl_seconds === "number" && Number.isFinite(body.ttl_seconds) ? body.ttl_seconds : 900;
    let installationId = body.installation_id;
    if (issuer.type === "internal_service") {
      // This credential is delegated by a public storefront endpoint. A registered
      // installation, not caller-selected tenant/origin alone, authorizes that context.
      if (!body.allowed_origin) throw new BadRequestException("public_embed_origin_required");
      if (body.cart_ref !== undefined) throw new BadRequestException("public_embed_cart_ownership_required");
      ttl = Math.min(ttl, 900);
      if (!installationId) {
        if (!this.listInstallations) throw new BadRequestException("public_embed_installation_required");
        const installations = await this.listInstallations.execute(issuer.merchantId, 200);
        const matches = installations.data.filter((installation) =>
          installation.status === "active" && installation.environment === issuer.environment &&
          installation.allowedOrigins.includes(body.allowed_origin!),
        );
        if (matches.length !== 1 || installations.hasMore) throw new BadRequestException("public_embed_installation_required");
        installationId = matches[0]!.id;
      }
    }
    const resolved = installationId
      ? await this.resolveInstallation.execute({
          merchantId: issuer.merchantId,
          installationId,
          requestedOrigin: body.allowed_origin,
          credentialEnvironment: issuer.environment,
        })
      : undefined;
    const result = this.issue.execute({
      merchantId: issuer.merchantId,
      ttlSeconds: ttl,
      installationId: resolved?.installation.id,
      environment: resolved?.installation.environment,
      widgetVersion: resolved?.installation.widgetVersion,
      allowedOrigin: resolved?.allowedOrigin ?? body.allowed_origin,
      scopes: body.scopes,
      cartRef: body.cart_ref,
    });

    const merchant = await this.merchants.getProfile(issuer.merchantId);

    return {
      ...result,
      widget_config: {
        brand: merchant?.theme ? {
          name: merchant.theme.headerTitle ?? merchant.name,
          logoUrl: merchant.theme.logoUrl ?? undefined,
          accentColor: merchant.theme.accentColor,
          backgroundColor: merchant.theme.backgroundColor,
          textColor: merchant.theme.textColor,
          fontFamily: merchant.theme.fontFamily,
          fontDisplay: merchant.theme.fontDisplay ?? undefined,
          borderRadius: merchant.theme.borderRadius,
          borderColor: merchant.theme.borderColor ?? undefined,
          surfaceColor: merchant.theme.surfaceColor ?? undefined,
          surfaceElevatedColor: merchant.theme.surfaceElevatedColor ?? undefined,
          mutedTextColor: merchant.theme.mutedTextColor ?? undefined,
          successColor: merchant.theme.successColor ?? undefined,
          warningColor: merchant.theme.warningColor ?? undefined,
          secondaryColor: merchant.theme.secondaryColor ?? undefined,
          mode: merchant.theme.mode ?? undefined,
          density: merchant.theme.density ?? undefined,
        } : undefined,
        agent: merchant?.theme?.agentName ? {
          name: merchant.theme.agentName,
          greeting: (merchant.theme as any).agentGreeting ?? undefined,
        } : undefined,
      },
    };
  }
}
