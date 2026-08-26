import {
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { KNOWLEDGE_REPOSITORY, type KnowledgeRepositoryPort } from "../../domain/ports/knowledge-repository.port.js";
import { IndexProductUseCase } from "../../application/use-cases/index-product.use-case.js";
import { IndexFaqUseCase } from "../../application/use-cases/index-faq.use-case.js";
import { IndexPolicyUseCase } from "../../application/use-cases/index-policy.use-case.js";
import { POLICY_REPOSITORY, type PolicyRepositoryPort } from "../../domain/ports/policy-repository.port.js";

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

@ApiTags("Knowledge Base")
@Controller("knowledge")
export class KnowledgeAdminController {
  private readonly logger = new Logger(KnowledgeAdminController.name);

  constructor(
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
    @Inject(POLICY_REPOSITORY) private readonly policyRepo: PolicyRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly indexProduct: IndexProductUseCase,
    private readonly indexFaq: IndexFaqUseCase,
    private readonly indexPolicy: IndexPolicyUseCase,
  ) {}

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Knowledge base status",
    description: "Returns chunk counts by source type for the current merchant.",
  })
  @ApiResponse({ status: 200, description: "Status retrieved" })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:read"] })
  @Get("status")
  async getStatus(@Req() request: unknown) {
    const merchantId = tenantId(request);
    const counts = await this.knowledgeRepo.countBySource(merchantId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return {
      total,
      products: counts["product"] ?? 0,
      policies: counts["policy"] ?? 0,
      faq: counts["faq"] ?? 0,
      config: counts["config"] ?? 0,
    };
  }

  @ApiBearerAuth("service_api_key")
  @ApiCookieAuth("console_session")
  @ApiOperation({
    summary: "Full reindex",
    description: "Triggers a full reindex of products, FAQ and policies for the current merchant.",
  })
  @ApiResponse({ status: 200, description: "Reindex started" })
  @UseGuards(TenantCredentialGuard, TenantAccessGuard)
  @RequireTenantAccess({ serviceScopes: ["support:write"] })
  @Post("reindex")
  async reindex(@Req() request: unknown) {
    const merchantId = tenantId(request);
    let productsIndexed = 0;
    let faqIndexed = 0;
    let policyIndexed = 0;

    // Reindex products
    try {
      const products = await this.prisma.product.findMany({
        where: { merchantId },
        include: {
          variants: { include: { price: true, stock: true } },
        },
      });

      for (const product of products) {
        const firstStock = product.variants[0]?.stock?.[0];
        await this.indexProduct.execute({
          merchantId,
          productId: product.id,
          name: product.name,
          description: product.description,
          variants: product.variants.map((v) => ({
            sku: v.sku ?? undefined,
            attributes: (v.attributes as Record<string, string>) ?? undefined,
          })),
          priceCents: product.variants[0]?.price?.basePriceInCents ?? undefined,
          quantity: firstStock?.quantity ?? 0,
        });
        productsIndexed++;
      }
    } catch (err) {
      this.logger.warn(`Reindex products failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Reindex FAQ
    try {
      const settings = await this.prisma.supportSetting.findUnique({
        where: { merchantId },
      });
      if (settings?.faqItems) {
        const raw = settings.faqItems as Array<{ id?: string; question: string; answer: string }>;
        const items = raw.map((it, i) => ({ id: it.id || `faq_${i}`, question: it.question, answer: it.answer }));
        await this.indexFaq.execute({ merchantId, faqItems: items });
        faqIndexed = items.length;
      }
    } catch (err) {
      this.logger.warn(`Reindex FAQ failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Reindex policies
    try {
      const policy = await this.policyRepo.get(merchantId);
      if (policy) {
        await this.indexPolicy.execute({ merchantId, policy });
        policyIndexed = 1;
      }
    } catch (err) {
      this.logger.warn(`Reindex policies failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      reindexed: true,
      productsIndexed,
      faqIndexed,
      policyIndexed,
    };
  }
}
