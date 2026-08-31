import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";

@Injectable()
export class CancelReturnUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(merchantId: string, returnId: string): Promise<{ id: string; status: "CANCELLED" }> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canCancel) {
      throw new BadRequestException("cannot_cancel_in_current_status");
    }

    await this.returnRepo.updateStatus(returnId, "CANCELLED");

    return { id: returnId, status: "CANCELLED" };
  }
}
