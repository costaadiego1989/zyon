import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpCode,
  Ip,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { LoginPlatformOperatorWithRateLimitUseCase } from "../application/login-platform-operator-with-rate-limit.use-case.js";
import { RefreshPlatformSessionUseCase } from "../application/refresh-platform-session.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control Authentication")
@Controller("platform/auth")
export class PlatformAuthController {
  private readonly logger = new Logger(PlatformAuthController.name);

  constructor(
    private readonly login: LoginPlatformOperatorWithRateLimitUseCase,
    private readonly sessions: RefreshPlatformSessionUseCase,
  ) {}

  @Post("login")
  @ApiOperation({ summary: "Authenticate a Zyon platform operator" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email" },
        password: { type: "string", format: "password" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Operator token issued" })
  async loginWithPassword(@Body() body: { email?: string; password?: string }, @Ip() ip: string) {
    try {
      if (typeof body.email !== "string" || typeof body.password !== "string") throw new Error("platform_invalid_credentials");
      return await this.login.execute({ email: body.email, password: body.password }, ip);
    } catch (error) {
      const failureCode = platformAuthFailureCode(error);
      if (failureCode === "platform_invalid_credentials") {
        throw new UnauthorizedException("invalid_platform_credentials");
      }
      if (error instanceof HttpException) throw error;
      this.logger.error(`platform_control_login_failed:${failureCode}`);
      throw new ServiceUnavailableException("platform_auth_unavailable");
    }
  }

  @Post("refresh")
  @ApiBearerAuth("PlatformOperatorJWT")
  @ApiOperation({ summary: "Rotate a platform operator token" })
  async refresh(@Req() request: { headers?: { authorization?: string | string[] } }) {
    const token = bearerToken(request.headers?.authorization);
    try {
      return await this.sessions.execute(token);
    } catch {
      throw new UnauthorizedException("platform_refresh_failed");
    }
  }

  @Post("logout")
  @HttpCode(204)
  @ApiBearerAuth("PlatformOperatorJWT")
  @ApiOperation({ summary: "Revoke the current platform operator session family" })
  async logout(@Req() request: { headers?: { authorization?: string | string[] } }): Promise<void> {
    try {
      await this.sessions.logout(bearerToken(request.headers?.authorization));
    } catch {
      throw new UnauthorizedException("invalid_platform_bearer_token");
    }
  }

  @Get("me")
  @UseGuards(PlatformAccessGuard)
  @ApiBearerAuth("PlatformOperatorJWT")
  @ApiOperation({ summary: "Return the authenticated platform operator" })
  me(@Req() request: PlatformPrincipalRequest) {
    const principal = currentPlatformPrincipal(request);
    return { operator_id: principal.operatorId, email: principal.email, role: principal.role };
  }
}

function bearerToken(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("missing_platform_bearer_token");
  return header.slice("Bearer ".length);
}
const KNOWN_PLATFORM_AUTH_FAILURE_CODES = new Set([
  "platform_invalid_credentials",
  "platform_jwt_invalid_ttl",
  "platform_jwt_secret_must_differ_from_tenant",
  "platform_jwt_secret_unconfigured",
  "platform_membership_changed",
]);

function platformAuthFailureCode(error: unknown): string {
  if (error instanceof Error && KNOWN_PLATFORM_AUTH_FAILURE_CODES.has(error.message)) return error.message;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return /^P\d{4}$/.test(error.code) ? error.code : "unknown";
  }
  return "unknown";
}
