import { Body, Controller, Post, UseGuards, ValidationPipe } from "@nestjs/common";
import { IsEthereumAddress, IsNotEmpty } from "class-validator";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { EnableCryptoPaymentsUseCase } from "../../application/use-cases/enable-crypto-payments.use-case.js";

export class EnableCryptoPaymentsDto {
  @IsEthereumAddress()
  @IsNotEmpty()
  merchantAddress!: `0x${string}`;
}

/**
 * Route aligned to /merchants/me/crypto-payments/enable (consistent plural).
 * Uses @CurrentTenant() instead of unsafe request casting.
 *
 * EVM addresses are public; the merchant's secret key never leaves their wallet.
 * No secret is collected server-side.
 */
@UseGuards(AuthGuard)
@Controller("merchants/me/crypto-payments")
export class CryptoPaymentsController {
  constructor(private readonly enableCrypto: EnableCryptoPaymentsUseCase) {}

  @Post("enable")
  enable(
    @CurrentTenant() merchantId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: EnableCryptoPaymentsDto
  ) {
    return this.enableCrypto.execute({
      merchantId,
      merchantAddress: dto.merchantAddress,
    });
  }
}
