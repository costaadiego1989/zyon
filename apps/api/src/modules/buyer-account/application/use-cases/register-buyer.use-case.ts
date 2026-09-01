import { ConflictException, Inject, Injectable , Logger} from "@nestjs/common";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface RegisterBuyerRequest {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
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
    private readonly jwt: BuyerJwtService
  ) {}

  async execute(input: RegisterBuyerRequest): Promise<BuyerAuthResponse> {
    if (!input.password || input.password.length < 8) {
      throw new Error("buyer_password_too_short");
    }
    const email = input.email.trim().toLowerCase();
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictException("email_already_registered");

    const passwordHash = await this.hasher.hash(input.password);
    const now = new Date();
    const account = new BuyerAccount({
      globalUserId: `buyer_${crypto.randomUUID().replace(/-/g, "")}`,
      email,
      passwordHash,
      displayName: input.displayName,
      phone: input.phone,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      createdAt: now,
      updatedAt: now,
    });
    await this.repo.save(account);
    return toBuyerAuthResponse(account, this.jwt);
  }
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
