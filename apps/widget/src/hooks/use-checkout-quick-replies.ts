import { useMemo } from "react";
import type { ShippingQuote, SuggestedProduct } from "@aacp/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import {
  filterCheckoutQuickReplies,
  matchShippingOptionFromLabel,
  normalizeQuickReplyLabel,
  type QuickReplyChoice,
} from "./checkout-presentation.js";
import type { PrePaymentStep } from "./use-checkout-pre-payment.js";

type ChatOffer = {
  approved?: boolean;
  type?: string;
  value?: number;
} | null | undefined;

type UseCheckoutQuickRepliesInput = {
  config: WidgetConfig;
  checkoutStage: string;
  currentMissingField?: string;
  prePaymentStep: PrePaymentStep;
  suggestedProducts: SuggestedProduct[];
  cryptoPaymentsEnabled?: boolean;
  chatQuickReplies: QuickReplyChoice[];
  shippingOptions: ShippingQuote[];
  offer: ChatOffer;
  visibleTotals: { discount: number };
  session: { session_id: string } | null;
  networkError: string | null;
  busy: boolean;
  addSuggestedProduct: (product: SuggestedProduct) => Promise<boolean>;
  proceedFromCrossSell: () => void;
  setCouponInputVisible: (visible: boolean) => void;
  setPrePaymentStep: (step: PrePaymentStep) => void;
  appendAgentTurn: (text: string, options?: { stream?: boolean }) => void;
  applyOffer: () => Promise<unknown>;
  setShowCardForm: (show: boolean) => void;
  setShowCryptoPanel: (show: boolean) => void;
  createPaymentIntent: (method: "pix" | "crypto" | "card") => Promise<unknown>;
  tapShippingOption: (option: ShippingQuote) => Promise<void>;
  tapQuickFromChat: (reply: QuickReplyChoice) => Promise<void>;
};

export function useCheckoutQuickReplies(input: UseCheckoutQuickRepliesInput) {
  const quickReplies = useMemo(() => {
    if (input.checkoutStage === "payment" && input.prePaymentStep === "payment_method") {
      const methods: QuickReplyChoice[] = [{ label: "Cartão de crédito" }, { label: "PIX" }];
      if (input.cryptoPaymentsEnabled) {
        methods.push({ label: "Pagar com crypto" });
      }
      return methods;
    }

    return filterCheckoutQuickReplies(input.chatQuickReplies, {
      stage: input.checkoutStage,
      missingField: input.currentMissingField,
      prePaymentStep: input.prePaymentStep,
      suggestedProducts:
        input.prePaymentStep === "cross_sell" ? input.suggestedProducts : undefined,
    });
  }, [
    input.chatQuickReplies,
    input.checkoutStage,
    input.cryptoPaymentsEnabled,
    input.currentMissingField,
    input.prePaymentStep,
    input.suggestedProducts,
  ]);

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!input.session || input.networkError || input.busy) return;
    if (
      !quickReplies.some(
        (allowed) =>
          allowed.label === reply.label &&
          allowed.type === reply.type &&
          allowed.offerId === reply.offerId,
      )
    ) {
      return;
    }

    const crossSellProduct = input.suggestedProducts.find((product) => {
      const label = normalizeQuickReplyLabel(reply.label);
      const productName = normalizeQuickReplyLabel(product.name);
      return (
        label === normalizeQuickReplyLabel(`Adicionar ${product.name}`) ||
        (label.startsWith("adicionar") && label.includes(productName))
      );
    });

    if (
      crossSellProduct &&
      input.checkoutStage === "payment" &&
      input.prePaymentStep === "cross_sell"
    ) {
      await input.addSuggestedProduct(crossSellProduct);
      return;
    }

    if (input.checkoutStage === "payment" && input.prePaymentStep === "cross_sell") {
      if (/^nao agora$/i.test(reply.label)) {
        input.proceedFromCrossSell();
        return;
      }
      if (/pagamento|finalizar|pagar/i.test(reply.label)) {
        input.proceedFromCrossSell();
        return;
      }
    }

    if (input.checkoutStage === "payment" && input.prePaymentStep === "coupon_gate") {
      const normalized = normalizeQuickReplyLabel(reply.label);
      if (normalized === "sim" || /^(sim|tenho|usar|informar).*\bcupom\b/.test(normalized)) {
        input.setCouponInputVisible(true);
        input.setPrePaymentStep("coupon_entry");
        input.appendAgentTurn(
          "Digite o codigo do cupom para eu aplicar antes de liberar o pagamento.",
          { stream: true },
        );
        return;
      }
      if (normalized === "nao" || /^(nao|sem)\b.*cupom|^nao tenho cupom$/.test(normalized)) {
        input.setCouponInputVisible(false);
        input.setPrePaymentStep("payment_method");
        if (input.offer?.approved && input.visibleTotals.discount === 0) {
          await input.applyOffer();
          input.appendAgentTurn(
            input.offer.type === "discount_percent" && (input.offer.value ?? 0) > 0
              ? `Sem problema. Liberamos ${input.offer.value}% de desconto para voce finalizar agora.`
              : "Perfeito. Liberamos uma condicao especial para voce finalizar agora.",
            { stream: true },
          );
        } else {
          input.appendAgentTurn("Perfeito. Agora escolha a forma de pagamento para finalizar.", {
            stream: true,
          });
        }
        return;
      }
    }

    if (input.checkoutStage === "payment" && /^(sim|tenho|usar|informar).*\bcupom\b/i.test(reply.label)) {
      input.setCouponInputVisible(true);
      input.setPrePaymentStep("coupon_entry");
      input.appendAgentTurn(
        "Digite o codigo do cupom para eu aplicar antes de liberar o pagamento.",
        { stream: true },
      );
      return;
    }

    if (input.checkoutStage === "payment" && /^(nao|sem)\b.*cupom|^nao tenho cupom$/i.test(reply.label)) {
      input.setCouponInputVisible(false);
      input.setPrePaymentStep("payment_method");
      if (input.offer?.approved && input.visibleTotals.discount === 0) {
        await input.applyOffer();
      }
      input.appendAgentTurn("Perfeito. Agora escolha a forma de pagamento para finalizar.", {
        stream: true,
      });
      return;
    }

    if (
      input.checkoutStage === "payment" &&
      input.prePaymentStep !== "payment_method" &&
      (/^pix$/i.test(reply.label) || /cartao|cartao de credito|cartao de debito/i.test(reply.label))
    ) {
      return;
    }

    if (/cartao|cartao de credito|cartao de debito|cart[aã]o/i.test(reply.label)) {
      input.setShowCryptoPanel(false);
      input.setShowCardForm(true);
      input.appendAgentTurn(
        "Vou abrir o pagamento por cartao agora. Confira o valor antes de confirmar: nenhuma cobranca acontece sem sua acao final.",
        { stream: true },
      );
      await input.createPaymentIntent("card");
      return;
    }

    if (/^(tenho|adicionar|usar|inserir|informar)\b.*\bcupom\b/i.test(reply.label)) {
      input.setCouponInputVisible(true);
      input.setPrePaymentStep("coupon_entry");
      input.appendAgentTurn("Insira o codigo do seu cupom abaixo para aplicar o desconto.", {
        stream: true,
      });
      return;
    }

    if (/aplicar.*desconto|aceitar.*desconto|aplicar oferta/i.test(reply.label)) {
      void input.applyOffer().then(() => {
        input.setPrePaymentStep("payment_method");
      });
      return;
    }

    if (/^pix$/i.test(reply.label)) {
      input.setShowCryptoPanel(false);
      await input.createPaymentIntent("pix");
      return;
    }

    if (/crypto|cripto/i.test(reply.label)) {
      input.setShowCardForm(false);
      input.setShowCryptoPanel(true);
      await input.createPaymentIntent("crypto");
      return;
    }

    if (/^boleto$/i.test(reply.label)) {
      input.appendAgentTurn(
        "No momento, o pagamento via boleto nao esta disponivel para esta compra. Por favor, escolha cartao de credito ou PIX.",
        { stream: true },
      );
      return;
    }

    if (input.checkoutStage === "shipping" && input.currentMissingField === "frete") {
      const shippingOption = matchShippingOptionFromLabel(reply.label, input.shippingOptions);
      if (shippingOption) {
        await input.tapShippingOption(shippingOption);
        return;
      }
    }

    return input.tapQuickFromChat(reply);
  }

  return { quickReplies, tapQuick };
}
