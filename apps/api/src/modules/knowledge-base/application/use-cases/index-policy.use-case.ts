import { Injectable, Inject, Logger } from "@nestjs/common";
import { EmbeddingService } from "../../../catalog/infrastructure/services/embedding.service.js";
import { KNOWLEDGE_REPOSITORY, type KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";
import type { MerchantPolicyData } from "../../domain/ports/policy-repository.port.js";

export interface IndexPolicyInput {
  merchantId: string;
  policy: MerchantPolicyData;
}

const FIELD_LABELS: Record<string, string> = {
  returns: "Política de trocas e devoluções",
  shipping: "Política de envio e frete",
  warranty: "Política de garantia",
  payment: "Formas de pagamento e parcelamento",
  general: "Informações gerais da loja",
};

@Injectable()
export class IndexPolicyUseCase {
  private readonly logger = new Logger(IndexPolicyUseCase.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
  ) {}

  async execute(input: IndexPolicyInput): Promise<void> {
    if (!this.embeddingService.isAvailable()) {
      this.logger.debug("Embedding service unavailable, skipping policy indexing");
      return;
    }

    const fields = ["returns", "shipping", "warranty", "payment", "general"] as const;

    for (const field of fields) {
      const text = input.policy[field];

      if (!text || !text.trim()) {
        // Remove stale chunks for empty fields
        try {
          await this.knowledgeRepo.deleteBySource(input.merchantId, "policy", field);
        } catch (err) {
          this.logger.warn(`Failed to delete stale policy chunk (${field}): ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      try {
        const content = `${FIELD_LABELS[field]}: ${text}`;
        const embedding = await this.embeddingService.generate(content);

        if (!embedding) {
          this.logger.warn(`Failed to generate embedding for policy field: ${field}`);
          continue;
        }

        await this.knowledgeRepo.upsertChunks(input.merchantId, "policy", field, [
          { content, embedding, metadata: { field } },
        ]);
      } catch (err) {
        this.logger.warn(`Failed to index policy field (${field}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.debug(`Indexed policy fields for merchant ${input.merchantId}`);
  }
}
