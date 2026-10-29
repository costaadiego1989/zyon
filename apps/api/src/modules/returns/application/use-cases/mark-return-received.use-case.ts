import { Injectable, Inject, BadRequestException, NotFoundException , Logger} from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";
import { ReturnEntity } from "../../domain/entities/return.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class MarkReturnReceivedUseCase {
  private readonly logger = new Logger(MarkReturnReceivedUseCase.name);

  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(merchantId: string, returnId: string): Promise<ReturnEntity> {
    const ret = await this.returnRepo.findById(merchantId, returnId);
    if (!ret) throw new NotFoundException("return_not_found");
    if (!ret.canMarkReceived) {
      throw new BadRequestException("invalid_status_for_receiving");
    }

    await this.returnRepo.updateStatus(returnId, "RECEIVED");

    return (await this.returnRepo.findById(merchantId, returnId))!;
  }
}
