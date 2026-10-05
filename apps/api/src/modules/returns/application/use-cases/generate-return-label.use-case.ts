import { Injectable, Inject, NotFoundException, NotImplementedException } from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";

@Injectable()
export class GenerateReturnLabelUseCase {
  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}
  async execute(merchantId: string, returnId: string): Promise<never> {
    if (!await this.returnRepo.findById(merchantId, returnId)) throw new NotFoundException("return_not_found");
    throw new NotImplementedException("shipping_label_provider_not_configured_use_conversation_instructions");
  }
}
