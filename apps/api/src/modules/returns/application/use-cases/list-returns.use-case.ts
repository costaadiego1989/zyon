import { Injectable, Inject , Logger} from "@nestjs/common";
import { RETURN_REPOSITORY_PORT, ReturnRepositoryPort, ListReturnsInput, ListReturnsResult } from "../../domain/ports/return-repository.port.js";
import { ReturnStatus } from "../../domain/entities/return.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ListReturnsUseCase {
  private readonly logger = new Logger(ListReturnsUseCase.name);

  constructor(@Inject(RETURN_REPOSITORY_PORT) private readonly returnRepo: ReturnRepositoryPort) {}

  async execute(input: {
    merchantId: string;
    status?: ReturnStatus;
    limit?: number;
    cursor?: string;
  }): Promise<ListReturnsResult> {
    return this.returnRepo.list({
      merchantId: input.merchantId,
      status: input.status,
      limit: input.limit ?? 20,
      cursor: input.cursor,
    });
  }
}
