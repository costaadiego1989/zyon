import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { AUTH_REPOSITORY, type AuthRepository } from "../domain/ports/auth-repository.port.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";

export interface RegisterMerchantRequest {
  merchant_id?: string;
  merchant_name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  merchant_id: string;
  user_id: string;
  email: string;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

@Injectable()
export class RegisterMerchantUseCase {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService
  ) {}

  async execute(input: RegisterMerchantRequest): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const existing = await this.repository.findUserByEmail(email);
    if (existing) throw new ConflictException("email_already_registered");
    const passwordHash = await this.passwordHasher.hash(input.password);
    // B4 (P2): Always generate merchant_id server-side. Accepting it from the
    // client allows squatting / pre-registering predictable IDs. The
    // findUserByEmail → create sequence was also a TOCTOU race; we rely on the
    // database unique constraint as the final arbiter and map violations to 409.
    const merchantId = `mrc_${crypto.randomUUID()}`;
    let created: { merchant: { id: string; name: string }; user: { id: string; merchantId: string; email: string; role: "owner" | "admin" } };
    try {
      created = await this.repository.createMerchantWithOwner({
        merchantId,
        merchantName: input.merchant_name,
        email,
        passwordHash
      });
    } catch (err: unknown) {
      // Map unique-constraint violations to 409 instead of 500.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unique constraint") || msg.includes("unique constraint") || msg.includes("P2002")) {
        throw new ConflictException("email_already_registered");
      }
      throw err;
    }
    return toAuthResponse(created.user, this.jwt);
  }
}

export function toAuthResponse(user: { id: string; merchantId: string; email: string; role: "owner" | "admin" }, jwt: JwtService): AuthResponse {
  return {
    merchant_id: user.merchantId,
    user_id: user.id,
    email: user.email,
    access_token: jwt.sign({
      userId: user.id,
      merchantId: user.merchantId,
      email: user.email,
      role: user.role
    }),
    token_type: "Bearer",
    expires_in: jwt.expiresIn()
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
