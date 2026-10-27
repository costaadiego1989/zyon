import { Inject, Injectable, UnauthorizedException , Logger} from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { toBuyerAuthResponse, type BuyerAuthResponse } from "./register-buyer.use-case.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface LoginBuyerRequest {
  email: string;
  password: string;
}

@Injectable()
export class LoginBuyerUseCase {
  private readonly logger = new Logger(LoginBuyerUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly jwt: BuyerJwtService
  ) {}

  async execute(input: LoginBuyerRequest): Promise<BuyerAuthResponse> {
    const email = input.email.trim().toLowerCase();
    const account = await this.repo.findByEmail(email);
    // C2 fix: reject phone-only accounts (passwordHash === null)
    if (!account || account.passwordHash === null) throw new UnauthorizedException("invalid_credentials");
    const valid = await this.hasher.verify(input.password, account.passwordHash);
    if (!valid) throw new UnauthorizedException("invalid_credentials");
    return toBuyerAuthResponse(account, this.jwt);
  }
}
