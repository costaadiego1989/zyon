import { Inject, Injectable } from "@nestjs/common";
import { ReturnCaseService, type OpenReturnCaseInput } from "../return-case.service.js";
import { RETURN_REPOSITORY_PORT, type ReturnRepositoryPort } from "../../domain/ports/return-repository.port.js";

@Injectable()
export class RequestReturnUseCase {
  constructor(private readonly cases: ReturnCaseService,
    @Inject(RETURN_REPOSITORY_PORT) private readonly repository: ReturnRepositoryPort) {}
  async execute(input: OpenReturnCaseInput) {
    const result = await this.cases.open(input);
    return (await this.repository.findById(input.merchantId, result.returnId))!;
  }
}
