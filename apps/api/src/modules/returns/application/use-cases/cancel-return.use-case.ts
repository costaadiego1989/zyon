import { Injectable, Inject, Optional, BadRequestException, NotFoundException } from "@nestjs/common";
import { ReturnReverseShippingService } from "../return-reverse-shipping.service.js";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";

@Injectable()
export class CancelReturnUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort,
    @Optional() @Inject(ReturnReverseShippingService) private readonly reverseShipping?: ReturnReverseShippingService) {}

  async execute(merchantId: string, returnId: string): Promise<{ id: string; status: "CANCELLED" }> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canCancel) {
      throw new BadRequestException("cannot_cancel_in_current_status");
    }

    if (this.reverseShipping) await this.reverseShipping.cancelReturn(merchantId, returnId);
    else await this.returnRepo.updateStatus(returnId, "CANCELLED", ret.status);

    return { id: returnId, status: "CANCELLED" };
  }
}
