import { BadRequestException, Injectable } from "@nestjs/common";
import type { CommerceCartPort, CommerceOrderPort, TrustedCartSnapshot } from "@zyon/commerce-adapters";

@Injectable()
export class DisabledCommerceAdapter implements CommerceCartPort, CommerceOrderPort {
  async validateCart(): Promise<TrustedCartSnapshot> {
    throw new BadRequestException("commerce_adapter_not_configured");
  }

  async createPendingOrder(): Promise<{ commerceOrderId: string }> {
    throw new BadRequestException("commerce_adapter_not_configured");
  }

  async markOrderPaid(): Promise<void> {
    throw new BadRequestException("commerce_adapter_not_configured");
  }

  async cancelOrder(): Promise<void> {
    throw new BadRequestException("commerce_adapter_not_configured");
  }
}
