import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Inject, BadRequestException } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { AddProductUseCase } from "../../application/use-cases/add-product.use-case.js";
import { SearchProductsUseCase } from "../../application/use-cases/search-products.use-case.js";
import { ReserveStockUseCase } from "../../application/use-cases/reserve-stock.use-case.js";
import { ConfirmStockUseCase } from "../../application/use-cases/confirm-stock.use-case.js";
import { GetProductUseCase } from "../../application/use-cases/get-product.use-case.js";
import { UpdateProductUseCase } from "../../application/use-cases/update-product.use-case.js";
import { DeleteProductUseCase } from "../../application/use-cases/delete-product.use-case.js";
import { ListCategoriesUseCase } from "../../application/use-cases/list-categories.use-case.js";
import { CreateCategoryUseCase } from "../../application/use-cases/create-category.use-case.js";
import { UpdateCategoryUseCase } from "../../application/use-cases/update-category.use-case.js";
import { DeleteCategoryUseCase } from "../../application/use-cases/delete-category.use-case.js";
import { ReorderCategoriesUseCase } from "../../application/use-cases/reorder-categories.use-case.js";
import { GenerateProductSeoUseCase } from "../../application/use-cases/generate-product-seo.use-case.js";

@UseGuards(AuthGuard, RequirePlanGuard)
@Controller("merchants")
export class StoreBuilderCatalogController {
  constructor(
    private readonly addProduct: AddProductUseCase,
    private readonly searchProducts: SearchProductsUseCase,
    private readonly reserveStock: ReserveStockUseCase,
    private readonly confirmStock: ConfirmStockUseCase,
    private readonly getProduct: GetProductUseCase,
    private readonly updateProduct: UpdateProductUseCase,
    private readonly deleteProduct: DeleteProductUseCase,
    private readonly listCategories: ListCategoriesUseCase,
    private readonly createCategory: CreateCategoryUseCase,
    private readonly updateCategory: UpdateCategoryUseCase,
    private readonly deleteCategory: DeleteCategoryUseCase,
    private readonly reorderCategories: ReorderCategoriesUseCase,
    private readonly generateProductSeo: GenerateProductSeoUseCase,
    private readonly s3: S3UploadService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Post(":mid/products")
  @RequirePlan("STORE_ONLY", "BOTH")
  async create(
    @Param("mid") merchantId: string,
    @Body() body: {
      name: string;
      description?: string;
      type?: string;
      metadata?: Record<string, unknown>;
      categoryId?: string;
      variants: Array<{
        sku: string;
        attributes?: Record<string, string>;
        barcode?: string;
        weightGrams?: number;
        lengthCm?: number;
        widthCm?: number;
        heightCm?: number;
        basePriceInCents: number;
        costInCents?: number;
        taxPercent?: number;
        currency?: string;
        stockQuantity?: number;
        media?: Array<{ url: string; type: "IMAGE" | "VIDEO"; alt?: string; order?: number }>;
      }>;
    },
  ) {
    return this.addProduct.execute({
      merchantId,
      name: body.name,
      description: body.description,
      type: body.type,
      metadata: body.metadata,
      categoryId: body.categoryId,
      variants: body.variants.map((v) => ({
        ...v,
        attributes: v.attributes ?? {},
      })),
    });
  }

  @Get(":mid/products")
  @RequirePlan("STORE_ONLY", "BOTH")
  async search(
    @Param("mid") merchantId: string,
    @Query("query") query?: string,
    @Query("categoryId") categoryId?: string,
    @Query("inStockOnly") inStockOnly?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("offset") offset?: string,
  ) {
    return this.searchProducts.execute({
      merchantId,
      query,
      categoryId,
      inStockOnly: inStockOnly === "true",
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(":mid/products/:pid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async detail(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
  ) {
    return this.getProduct.execute(merchantId, productId);
  }

  @Put(":mid/products/:pid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async update(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: {
      name?: string;
      description?: string;
      type?: string;
      metadata?: Record<string, unknown>;
      categoryId?: string;
      isActive?: boolean;
    },
  ) {
    return this.updateProduct.execute({
      merchantId,
      productId,
      name: body.name,
      description: body.description,
      type: body.type,
      metadata: body.metadata,
      categoryId: body.categoryId,
      isActive: body.isActive,
    });
  }

  @Put(":mid/products/:pid/variants/:vid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateVariant(
    @Param("mid") merchantId: string,
    @Param("pid") _productId: string,
    @Param("vid") variantId: string,
    @Body() body: {
      basePriceInCents?: number;
      costInCents?: number | null;
      stockQuantity?: number;
      weightGrams?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    },
  ) {
    // Update variant fields
    if (body.basePriceInCents !== undefined || body.costInCents !== undefined) {
      await this.prisma.productPrice.updateMany({
        where: { variantId },
        data: {
          ...(body.basePriceInCents !== undefined ? { basePriceInCents: body.basePriceInCents } : {}),
          ...(body.costInCents !== undefined ? { costInCents: body.costInCents } : {}),
        },
      });
    }
    if (body.weightGrams !== undefined || body.lengthCm !== undefined || body.widthCm !== undefined || body.heightCm !== undefined) {
      await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(body.weightGrams !== undefined ? { weightGrams: body.weightGrams } : {}),
          ...(body.lengthCm !== undefined ? { lengthCm: body.lengthCm } : {}),
          ...(body.widthCm !== undefined ? { widthCm: body.widthCm } : {}),
          ...(body.heightCm !== undefined ? { heightCm: body.heightCm } : {}),
        },
      });
    }
    if (body.stockQuantity !== undefined) {
      await this.prisma.productStock.updateMany({
        where: { variantId },
        data: { quantity: body.stockQuantity },
      });
    }
    return { updated: true };
  }

  @Delete(":mid/products/:pid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async remove(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
  ) {
    await this.deleteProduct.execute(merchantId, productId);
    return { deleted: true };
  }

  @Post(":mid/stock/reserve")
  @RequirePlan("STORE_ONLY", "BOTH")
  async reserve(
    @Param("mid") merchantId: string,
    @Body() body: { variantId: string; quantity: number; cartId?: string; idempotencyKey: string },
  ) {
    return this.reserveStock.execute({
      merchantId,
      variantId: body.variantId,
      quantity: body.quantity,
      cartId: body.cartId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post(":mid/stock/confirm")
  @RequirePlan("STORE_ONLY", "BOTH")
  async confirm(
    @Param("mid") merchantId: string,
    @Body() body: { reservationId: string },
  ) {
    await this.confirmStock.execute(merchantId, body.reservationId);
    return { confirmed: true };
  }

  // --- Categories ---

  @Get(":mid/categories")
  @RequirePlan("STORE_ONLY", "BOTH")
  async categories(@Param("mid") merchantId: string) {
    return this.listCategories.execute(merchantId);
  }

  @Post(":mid/categories")
  @RequirePlan("STORE_ONLY", "BOTH")
  async createCat(
    @Param("mid") merchantId: string,
    @Body() body: {
      name: string;
      slug?: string;
      parentId?: string;
      description?: string;
      imageUrl?: string;
    },
  ) {
    return this.createCategory.execute(merchantId, body);
  }

  @Put(":mid/categories/:cid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateCat(
    @Param("mid") merchantId: string,
    @Param("cid") categoryId: string,
    @Body() body: {
      name?: string;
      parentId?: string;
      parent_id?: string;
      description?: string;
      imageUrl?: string;
      image_url?: string;
      isActive?: boolean;
      is_active?: boolean;
      sortOrder?: number;
      sort_order?: number;
    },
  ) {
    const normalized = {
      name: body.name,
      parentId: body.parentId ?? body.parent_id,
      description: body.description,
      imageUrl: body.imageUrl ?? body.image_url,
      isActive: body.isActive ?? body.is_active,
      sortOrder: body.sortOrder ?? body.sort_order,
    };
    return this.updateCategory.execute(merchantId, categoryId, normalized);
  }

  @Delete(":mid/categories/:cid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async deleteCat(
    @Param("mid") merchantId: string,
    @Param("cid") categoryId: string,
  ) {
    await this.deleteCategory.execute(merchantId, categoryId);
    return { deleted: true };
  }

  @Patch(":mid/categories/reorder")
  @RequirePlan("STORE_ONLY", "BOTH")
  async reorderCats(
    @Param("mid") merchantId: string,
    @Body() body: Array<{ id: string; sort_order: number }>,
  ) {
    await this.reorderCategories.execute(merchantId, body);
    return { reordered: true };
  }

  // --- Product Media ---

  @Post(":mid/products/media")
  @RequirePlan("STORE_ONLY", "BOTH")
  async uploadMedia(
    @Param("mid") merchantId: string,
    @Body() body: { variantId: string; image: string },
  ) {
    if (!body.variantId || !body.image) throw new BadRequestException("variantId_and_image_required");
    if (!this.s3.isConfigured()) throw new BadRequestException("s3_not_configured");

    const result = await this.s3.uploadBase64(body.image, `merchants/${merchantId}/products`);
    const media = await this.prisma.productMedia.create({
      data: {
        variantId: body.variantId,
        url: result.url,
        type: "IMAGE",
        order: 0,
      },
    });
    return { id: media.id, url: media.url };
  }

  @Delete(":mid/products/media/:mediaId")
  @RequirePlan("STORE_ONLY", "BOTH")
  async deleteMedia(
    @Param("mid") _merchantId: string,
    @Param("mediaId") mediaId: string,
  ) {
    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    return { deleted: true };
  }

  @Post(":mid/products/:pid/generate-seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateSeo(
    @Param("mid") merchantId: string,
    @Param("pid") productId: string,
    @Body() body: { tone?: "profissional" | "casual" | "luxo" | "técnico" },
  ) {
    return this.generateProductSeo.execute({ merchantId, productId, tone: body.tone });
  }

  @Post(":mid/products/generate-description")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateDescription(
    @Param("mid") _merchantId: string,
    @Body() body: { name: string; notes?: string; type?: string },
  ) {
    const prompt = `Gere uma descrição de produto para e-commerce em português brasileiro.
Nome do produto: ${body.name}
Tipo: ${body.type ?? "physical"}
${body.notes ? `Referência do lojista: ${body.notes}` : ""}

Regras:
- Máximo 3 parágrafos curtos
- Tom profissional e persuasivo
- Destaque benefícios, não apenas características
- Não use markdown, apenas texto puro
- Não invente especificações técnicas`;

    // Try local LLM first (Ollama), fallback to DeepSeek
    const providers = [
      {
        baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.LOCAL_LLM_API_KEY || "ollama",
        model: process.env.LOCAL_LLM_MODEL || "llama3.2",
      },
      {
        baseUrl: process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || "deepseek-chat",
      },
    ];

    for (const provider of providers) {
      if (!provider.apiKey) continue;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 300,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) continue;

        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (text) return { description: text };
      } catch {
        // Provider failed, try next
        continue;
      }
    }

    throw new BadRequestException("ai_generation_failed: all providers unavailable");
  }
}