import { Injectable, Inject } from "@nestjs/common";
import { BUYER_TEMPLATE_REPOSITORY, type BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";

@Injectable()
export class ListTemplatesForBuyerUseCase {
  constructor(
    @Inject(BUYER_TEMPLATE_REPOSITORY) private readonly templates: BuyerTemplateRepository
  ) {}

  async execute(buyer_user_id: string) {
    const all = await this.templates.findByBuyerUserId(buyer_user_id);
    return all.filter((t) => t.is_active).map((t) => t.snapshot());
  }
}
