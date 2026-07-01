import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { EnableCryptoPaymentsUseCase } from "../../application/use-cases/enable-crypto-payments.use-case.js";

export class EnableCryptoPaymentsDto {
  @IsString()
  @IsNotEmpty()
  merchantPublicKey!: string;

  @IsString()
  @IsNotEmpty()
  merchantSecretKey!: string;
}

@UseGuards(AuthGuard)
@Controller("merchant/crypto-payments")
export class CryptoPaymentsController {
  constructor(private readonly enableCrypto: EnableCryptoPaymentsUseCase) {}

  @Post("enable")
  enable(
    @Req() request: unknown,
    @Body() dto: EnableCryptoPaymentsDto
  ) {
    const { merchantId } = currentUser(request as { user?: unknown });
    return this.enableCrypto.execute({
      merchantId,
      merchantPublicKey: dto.merchantPublicKey,
      merchantSecretKey: dto.merchantSecretKey,
    });
  }
}
