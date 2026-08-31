import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  ASAAS_PLATFORM_PORT,
  type AsaasPlatformPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import { requiredConnection, requiredAsaasSecret } from "../shared.js";

@Injectable()
export class GetAsaasOnboardingLinkUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(merchantId: string): Promise<{ url: string }> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "asaas",
    );
    const elapsed = Date.now() - new Date(connection.createdAt).getTime();
    if (elapsed < 15_000) {
      throw new ConflictException({
        code: "asaas_documents_not_ready",
        detail:
          "Asaas requires at least 15 seconds before document discovery.",
        retry_after_seconds: Math.ceil((15_000 - elapsed) / 1000),
      });
    }
    const apiKey = await requiredAsaasSecret(
      this.repository,
      merchantId,
    );
    const links = await this.asaas.listOnboardingLinks(apiKey);
    if (links.length === 0) {
      throw new ConflictException("asaas_onboarding_link_not_available");
    }
    return { url: links[0]! };
  }
}

