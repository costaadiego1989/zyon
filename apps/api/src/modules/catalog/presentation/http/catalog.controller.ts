import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
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

@UseGuards(RequirePlanGuard)
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
  ) {}

  @Post(":mid/products")
  @RequirePlan("STORE_ONLY", "BOTH")
  async create(
    @Param("mid") merchantId: string,
    @Body() body: {
      name: string;
      description?: string;
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
  ) {
    return this.searchProducts.execute({
      merchantId,
      query,
      categoryId,
      inStockOnly: inStockOnly === "true",
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
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
      categoryId?: string;
      isActive?: boolean;
    },
  ) {
    return this.updateProduct.execute({
      merchantId,
      productId,
      name: body.name,
      description: body.description,
      categoryId: body.categoryId,
      isActive: body.isActive,
    });
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
    @Body() body: { name: string; slug?: string; parentId?: string },
  ) {
    return this.createCategory.execute(merchantId, body);
  }

  @Put(":mid/categories/:cid")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateCat(
    @Param("mid") merchantId: string,
    @Param("cid") categoryId: string,
    @Body() body: { name?: string; parentId?: string },
  ) {
    return this.updateCategory.execute(merchantId, categoryId, body);
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
}