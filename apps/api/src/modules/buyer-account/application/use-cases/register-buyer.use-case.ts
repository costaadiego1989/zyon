import { ConflictException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { CustomerAddress } from "@zyon/shared-types";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BuyerAddress } from "../../domain/entities/buyer-address.entity.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BUYER_ADDRESS_REPOSITORY, type BuyerAddressRepository } from "../../domain/ports/buyer-address.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";

export interface RegisterBuyerRequest {
  email: string;
  password?: string;
  displayName: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  cpf?: string;
  address?: CustomerAddress;
}

export interface BuyerAuthResponse {
  globalUserId: string;
  email: string;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  profileComplete: boolean;
  name?: string;
}

@Injectable()
export class RegisterBuyerUseCase {
  private readonly logger = new Logger(RegisterBuyerUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly jwt: BuyerJwtService,
    @Optional() @Inject(BUYER_ADDRESS_REPOSITORY) private readonly addresses?: BuyerAddressRepository,
  ) {}

  async execute(input: RegisterBuyerRequest): Promise<BuyerAuthResponse> {
    // OTP-verified checkout registration does not collect a password. When one
    // is supplied it must be strong; when absent we mint a random unusable
    // password so the account exists and can be logged into via OTP/session.
    if (input.password && input.password.length < 8) {
      throw new Error("buyer_password_too_short");
    }
    const rawPassword = input.password ?? crypto.randomUUID() + crypto.randomUUID();
    const email = input.email.trim().toLowerCase();
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictException("email_already_registered");

    const passwordHash = await this.hasher.hash(rawPassword);
    const now = new Date();
    const account = new BuyerAccount({
      globalUserId: `buyer_${crypto.randomUUID().replace(/-/g, "")}`,
      email,
      passwordHash,
      displayName: input.displayName,
      phone: input.phone,
      cpf: input.cpf,
      address: input.address,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      createdAt: now,
      updatedAt: now,
    });
    const savedAddress = input.address
      ? createInitialSavedAddress(account.globalUserId, input.address, now)
      : undefined;

    await this.repo.save(account);
    if (savedAddress && this.addresses) {
      await this.addresses.save(savedAddress);
    }

    return toBuyerAuthResponse(account, this.jwt);
  }
}

function createInitialSavedAddress(
  globalUserId: string,
  address: CustomerAddress,
  createdAt: Date,
): BuyerAddress {
  return BuyerAddress.create({
    id: `registration_${globalUserId}`,
    globalUserId,
    zip: address.zip ?? "",
    street: address.street ?? "",
    number: address.number ?? "",
    complement: address.complement,
    neighborhood: address.neighborhood ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    isDefault: true,
    createdAt,
  });
}

export function toBuyerAuthResponse(account: BuyerAccount, jwt: BuyerJwtService, merchantId?: string): BuyerAuthResponse {
  // Profile is complete when the buyer has a real name (not the "+55..." phone placeholder),
  // a real email (not the "phone_xxx@buyer.aacp" placeholder), and a CPF.
  const hasRealName = !!account.displayName && !account.displayName.startsWith("+");
  const hasRealEmail = !!account.email && !account.email.includes("@buyer.aacp");
  const profileComplete = hasRealName && hasRealEmail && !!account.cpf;
  return {
    globalUserId: account.globalUserId,
    email: account.email,
    // H3 fix: include merchantId in JWT claims when issued via session
    accessToken: jwt.sign({ globalUserId: account.globalUserId, email: account.email, merchantId }),
    tokenType: "Bearer",
    expiresIn: jwt.expiresIn(),
    profileComplete,
    name: hasRealName ? account.displayName : undefined,
  };
}
