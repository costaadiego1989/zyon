import { Injectable, Inject, BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import type { ReturnEntity } from "../../domain/entities/return.entity.js";

@Injectable()
export class ProcessRefundUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret || ret.merchantId !== merchantId) throw new NotFoundException("return_not_found");
    if (!ret.canRefund) {
      throw new BadRequestException("invalid_status_for_refund");
    }

    // No refund adapter or authoritative order allocation is wired in ReturnsModule.
    // Preserve the original state until an idempotent provider refund can be reconciled.
    throw new ServiceUnavailableException({
      code: "refund_provider_unavailable",
      message: "O reembolso ainda não está disponível. Nenhum estorno foi realizado.",
    });
  }
}
