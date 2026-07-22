import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { WebAuthnRegisterOptionsUseCase } from "../../application/use-cases/webauthn-register-options.use-case.js";
import { WebAuthnRegisterVerifyUseCase } from "../../application/use-cases/webauthn-register-verify.use-case.js";
import { WebAuthnLoginOptionsUseCase } from "../../application/use-cases/webauthn-login-options.use-case.js";
import { WebAuthnLoginVerifyUseCase } from "../../application/use-cases/webauthn-login-verify.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

/**
 * HTTP controller for WebAuthn biometric login flows.
 *
 * Endpoints:
 *   POST /buyer/webauthn/register/options   — generate registration challenge (requires auth)
 *   POST /buyer/webauthn/register/verify    — verify attestation, store credential (requires auth)
 *   POST /buyer/webauthn/login/options      — generate authentication challenge (public)
 *   POST /buyer/webauthn/login/verify       — verify assertion, issue JWT (public)
 */
@Controller("buyer/webauthn")
export class BuyerWebAuthnController {
  constructor(
    private readonly registerOptions: WebAuthnRegisterOptionsUseCase,
    private readonly registerVerify: WebAuthnRegisterVerifyUseCase,
    private readonly loginOptions: WebAuthnLoginOptionsUseCase,
    private readonly loginVerify: WebAuthnLoginVerifyUseCase,
  ) {}

  /**
   * POST /buyer/webauthn/register/options
   * Requires authenticated buyer (already logged in via password/OTP).
   */
  @Post("register/options")
  @UseGuards(BuyerJwtAuthGuard)
  async getRegisterOptions(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.registerOptions.execute({ buyer_id: buyer.globalUserId });
  }

  /**
   * POST /buyer/webauthn/register/verify
   * Requires authenticated buyer. Body is the credential response from navigator.credentials.create().
   */
  @Post("register/verify")
  @UseGuards(BuyerJwtAuthGuard)
  async verifyRegistration(
    @Req() req: { user?: unknown },
    @Body() body: {
      challenge: string;
      credential: {
        id: string;
        rawId: string;
        response: { attestationObject: string; clientDataJSON: string };
        type: "public-key";
      };
    },
  ) {
    const buyer = currentBuyer(req);
    const challengeBytes = new Uint8Array(Buffer.from(body.challenge, "base64url"));
    return this.registerVerify.execute({
      buyer_id: buyer.globalUserId,
      credential: {
        id: body.credential.id,
        rawId: body.credential.rawId,
        authenticatorData: body.credential.response.attestationObject,
        clientDataJSON: body.credential.response.clientDataJSON,
        type: body.credential.type,
      },
      challenge: challengeBytes,
    });
  }

  /**
   * POST /buyer/webauthn/login/options
   * Public endpoint. Client provides email to fetch allowed credentials.
   */
  @Post("login/options")
  async getLoginOptions(@Body() body: { email?: string }) {
    return this.loginOptions.execute({ email: body.email });
  }

  /**
   * POST /buyer/webauthn/login/verify
   * Public endpoint. Verifies assertion and issues JWT.
   */
  @Post("login/verify")
  async verifyLogin(
    @Body() body: {
      challenge: string;
      credential: {
        id: string;
        rawId: string;
        response: { authenticatorData: string; clientDataJSON: string; signature: string };
        type: "public-key";
      };
    },
  ) {
    const challengeBytes = new Uint8Array(Buffer.from(body.challenge, "base64url"));
    return this.loginVerify.execute({
      challenge: challengeBytes,
      credential: {
        id: body.credential.id,
        rawId: body.credential.rawId,
        authenticatorData: body.credential.response.authenticatorData,
        clientDataJSON: body.credential.response.clientDataJSON,
        signature: body.credential.response.signature,
        type: body.credential.type,
      },
    });
  }
}
