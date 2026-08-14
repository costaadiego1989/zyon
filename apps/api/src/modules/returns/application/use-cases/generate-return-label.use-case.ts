import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";

@Injectable()
export class GenerateReturnLabelUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canGenerateLabel) {
      throw new BadRequestException("invalid_status_for_label_generation");
    }

    // MVP stub: generate fake tracking
    const carrier = "CORREIOS";
    const trackingNumber = `RMA${Date.now().toString(36).toUpperCase()}BR`;
    const labelUrl = `https://labels.stub.zyon.dev/${returnId}.pdf`;
    const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days

    await this.returnRepo.saveLabel({
      returnId,
      carrier,
      trackingNumber,
      labelUrl,
      expiresAt,
    });

    await this.returnRepo.updateStatus(returnId, "LABEL_GENERATED");

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
