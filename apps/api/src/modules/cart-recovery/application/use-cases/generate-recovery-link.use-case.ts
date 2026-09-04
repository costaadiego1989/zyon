import { Injectable } from "@nestjs/common";

export interface GenerateRecoveryLinkInput {
  merchantCheckoutReturnUrl?: string | null;
  sessionId: string;
  cartRef?: string | null;
  embedToken?: string | null;
}

@Injectable()
export class GenerateRecoveryLinkUseCase {
  /**
   * Builds a deep link that takes the buyer back to their abandoned cart.
   * Uses merchant.checkoutReturnUrl when set; falls back to widget mount URL.
   */
  execute(input: GenerateRecoveryLinkInput): string {
    const base = this.resolveBaseUrl(input.merchantCheckoutReturnUrl);
    const params = new URLSearchParams();
    if (input.embedToken) params.set("embedToken", input.embedToken);
    if (input.cartRef) params.set("cartRef", input.cartRef);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  private resolveBaseUrl(merchantUrl?: string | null): string {
    const envUrl = process.env.PUBLIC_WIDGET_URL;
    return merchantUrl || envUrl || "https://widget.aacp.com/checkout";
  }
}