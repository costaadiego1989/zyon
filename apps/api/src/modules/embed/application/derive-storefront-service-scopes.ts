import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { AuthorizeStorefrontCartService } from "./authorize-storefront-cart.service.js";
import { ResolveEmbedBuyerService } from "./resolve-embed-buyer.service.js";

/** Narrow grant derivation inside the existing issuer. Not a credential issuer,
 * not a caller-requestable flag and not authority to confirm a slot or payment. */
@Injectable()
export class DeriveStorefrontServiceScopes {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly buyers: ResolveEmbedBuyerService, private readonly carts: AuthorizeStorefrontCartService) {}

  async execute(input: { merchantId: string; cartRef: string; origin: string; conversationToken: unknown; buyerToken: unknown; scopes?: readonly string[] }): Promise<string[] | undefined> {
    const bound = { ...input, scopes: input.scopes ? [...input.scopes] : undefined };
    // Preserve explicit grants of the existing authenticated issuer. The public
    // checkout-token proxy never accepts caller scopes. This helper derives only
    // the missing grant; it does not rewrite pre-existing internal issuer grants.
    if (bound.scopes?.includes("appointments:confirm")) return bound.scopes;
    // No scope/body/default changes for product companies or undecided modes.
    const merchant = await this.prisma.merchant.findUnique({ where: { id: bound.merchantId }, select: {
      businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
    } });
    if (merchant?.businessMode !== "services" || !merchant.businessModeSelectedAt || merchant.businessModeNeedsReview) return bound.scopes;
    // Defaults are the original issuer's concern, never reconstructed here.
    if (!bound.scopes?.includes("checkout:start")) return bound.scopes;
    const proof = { token: bound.conversationToken, merchantId: bound.merchantId, cartRef: bound.cartRef, origin: bound.origin };
    this.carts.authorize(proof);
    const identity = this.carts.userIdentity(proof);
    const buyer = await this.buyers.resolve(bound.merchantId, bound.buyerToken);
    if (!buyer) return bound.scopes.filter(scope => scope !== "appointments:confirm");
    if (identity?.startsWith("buyer:") && identity !== `buyer:${buyer.globalUserId}`) throw new UnauthorizedException("public_embed_buyer_binding_mismatch");
    // A first consultation can have no stored parent. Ownership is the signed
    // existing conversation binding. T40 revalidates buyer/cart/slot on each use.
    return [...new Set([...bound.scopes, "appointments:confirm"])];
  }
}
