import { Injectable, Inject , Logger} from "@nestjs/common";
import { BUYER_TEMPLATE_REPOSITORY, type BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ListTemplatesForBuyerUseCase {
  private readonly logger = new Logger(ListTemplatesForBuyerUseCase.name);

  constructor(
    @Inject(BUYER_TEMPLATE_REPOSITORY) private readonly templates: BuyerTemplateRepository
  ) {}

  async execute(buyer_user_id: string) {
    const all = await this.templates.findByBuyerUserId(buyer_user_id);
    return all.filter((t) => t.is_active).map((t) => t.snapshot());
  }
}
