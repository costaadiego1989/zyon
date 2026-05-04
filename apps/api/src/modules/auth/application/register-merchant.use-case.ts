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
    const created = await this.repository.createMerchantWithOwner({
      merchantId: input.merchant_id ?? `mrc_${crypto.randomUUID()}`,
      merchantName: input.merchant_name,
      email,
      passwordHash
    });
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
