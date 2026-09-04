import { Body, Controller, Post, UseGuards, ValidationPipe } from "@nestjs/common";
import { IsBoolean, IsEthereumAddress, IsIn, IsNotEmpty, IsOptional } from "class-validator";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { EnableCryptoPaymentsUseCase } from "../../application/use-cases/enable-crypto-payments.use-case.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";

export class EnableCryptoPaymentsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsIn(["polygon", "base"])
  chain!: "polygon" | "base";

  @IsIn(["mainnet", "testnet"])
  network!: "mainnet" | "testnet";

  @IsEthereumAddress()
  @IsNotEmpty()
  treasuryAddress!: string;

  @IsOptional()
  @IsIn(["USDC"])
  token?: "USDC";
}

@UseGuards(AuthGuard)
@Controller("merchants/me/crypto-payments")
export class CryptoPaymentsController {
  constructor(private readonly enableCrypto: EnableCryptoPaymentsUseCase) {}

  @Post("enable")
  @UseGuards(PlanLimitGuard)
  @RequirePlanFeature("cryptoPayments")
  enable(
    @CurrentTenant() merchantId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: EnableCryptoPaymentsDto
  ) {
    return this.enableCrypto.execute({
      merchantId,
      enabled: dto.enabled ?? true,
      chain: dto.chain,
      network: dto.network,
      treasuryAddress: dto.treasuryAddress,
      token: dto.token ?? "USDC",
    });
  }
}
