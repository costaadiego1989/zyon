import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiPropertyOptional,
  ApiTags,
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
import { ResolveInstallationForEmbedUseCase } from "../../../installations/application/installation.use-cases.js";

class IssueEmbedSessionDto {
  @ApiPropertyOptional({ example: "cm123installation" })
  @IsOptional()
  @IsString()
  installation_id?: string;

  @ApiPropertyOptional({ minimum: 60, maximum: 86400, example: 900 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  ttl_seconds?: number;

  @ApiPropertyOptional({ example: "https://checkout.example.com" })
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

  @ApiPropertyOptional({ example: "cart_123" })
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
  ) {}

  @Post()
  @Idempotent()
  async issueSession(
    @Req() request: unknown,
    @Body() body: IssueEmbedSessionDto,
  ) {
    if ("merchant_id" in (body as object)) {
      throw new BadRequestException("merchant_id_is_credential_derived");
    }
    const issuer = currentEmbedIssuer(request as never);
    const ttl = typeof body?.ttl_seconds === "number" && Number.isFinite(body.ttl_seconds) ? body.ttl_seconds : 900;
    const resolved = body.installation_id
      ? await this.resolveInstallation.execute({
          merchantId: issuer.merchantId,
          installationId: body.installation_id,
          requestedOrigin: body.allowed_origin,
          credentialEnvironment: issuer.environment,
        })
      : undefined;
    return this.issue.execute({
      merchantId: issuer.merchantId,
      ttlSeconds: ttl,
      installationId: resolved?.installation.id,
      environment: resolved?.installation.environment,
      widgetVersion: resolved?.installation.widgetVersion,
      allowedOrigin: resolved?.allowedOrigin ?? body.allowed_origin,
      scopes: body.scopes,
      cartRef: body.cart_ref,
    });
  }
}
