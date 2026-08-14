import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity, ItemCondition } from "../../domain/entities/return.entity.js";

@Injectable()
export class InspectReturnUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(
    merchantId: string,
    returnId: string,
    input: { inspectedBy: string; itemCondition: ItemCondition; verdict: string; notes?: string },
  ): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canInspect) {
      throw new BadRequestException("invalid_status_for_inspection");
    }

    const pass = input.itemCondition !== "UNUSABLE";

    await this.returnRepo.saveInspection({
      returnId,
      inspectedBy: input.inspectedBy,
      itemCondition: input.itemCondition,
      verdict: input.verdict,
      notes: input.notes,
    });

    const newStatus = pass ? "INSPECTED_PASS" : "INSPECTED_FAIL";
    await this.returnRepo.updateStatus(returnId, newStatus);

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
