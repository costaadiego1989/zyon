import { Injectable } from "@nestjs/common";
import { AddCrossStoreItemUseCase } from "../../../marketplace/application/use-cases/add-cross-store-item.use-case.js";

export interface AddMarketplaceItemToCartInput {
  merchantId: string;
  checkoutSessionId: string;
  sellerMerchantId: string;
  federatedProductId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface AddMarketplaceItemToCartOutput {
  success: boolean;
  lineItemId?: string;
  message: string;
}

@Injectable()
export class AddMarketplaceItemToCartStorefrontUseCase {
  constructor(private readonly addCrossStoreItem: AddCrossStoreItemUseCase) {}

  async execute(
    input: AddMarketplaceItemToCartInput
  ): Promise<AddMarketplaceItemToCartOutput> {
    try {
      const result = await this.addCrossStoreItem.execute({
        checkoutSessionId: input.checkoutSessionId,
        hostMerchantId: input.merchantId,
        sellerMerchantId: input.sellerMerchantId,
        federatedProductId: input.federatedProductId,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
      });

      return {
        success: true,
        lineItemId: result.lineItem.id,
        message: `Produto adicionado ao carrinho (Vendido por: loja parceira)`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro ao adicionar item";
      return {
        success: false,
        message: `Erro: ${message}`,
      };
    }
  }
}
