import { Body, Controller, Post, UseGuards, ValidationPipe } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { EnableCryptoPaymentsUseCase } from "../../application/use-cases/enable-crypto-payments.use-case.js";

export class EnableCryptoPaymentsDto {
  @IsString()
  @IsNotEmpty()
  merchantPublicKey!: string;

  @IsString()
  @IsNotEmpty()
  merchantSecretKey!: string;
}

/**
 * MERC-H5: Route aligned to /merchants/me/crypto-payments/enable (consistent plural).
 * MERC-H2: Uses @CurrentTenant() instead of unsafe request casting.
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
      merchantPublicKey: dto.merchantPublicKey,
      merchantSecretKey: dto.merchantSecretKey,
    });
  }
}
