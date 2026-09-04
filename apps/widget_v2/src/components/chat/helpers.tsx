import type { ReactNode } from "react";
import type { ChatBlock } from "@/api/checkout-session";

export function renderInlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}


function blockToNarration(block: ChatBlock): string | null {
  switch (block.type) {
    case "address_confirmation":
      return block.data?.formatted
        ? `Localizei o endereço ${block.data.formatted}. Está correto?`
        : "Confirme o endereço de entrega.";
    case "shipping_options": {
      const opts = (block.data?.options as Array<{ label: string; cost?: number }>) ?? [];
      if (!opts.length) return null;
      return `Temos ${opts.length} opções de frete: ${opts.map(o => translateShippingLabel(o.label)).join(", ")}. Qual prefere?`;
    }
    case "payment_methods": {
      const meths = (block.data?.methods as Array<{ label: string }>) ?? [];
      if (!meths.length) return null;
      return `As formas de pagamento disponíveis são: ${meths.map(m => m.label).join(", ")}. Qual prefere?`;
    }
    case "cart_summary": {
      const total = block.data?.total as number | undefined;
      if (total) {
        const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total);
        return `O total do pedido é ${fmt}.`;
      }
      return null;
    }
    case "pix_payment":
      return "Gerei o código Pix. Escaneie o QR Code no app do banco.";
    case "crypto_chain_select":
      return "Escolha a rede para pagar com USDC: Polygon ou Base.";
    case "crypto_payment": {
      const amount = block.data?.crypto_amount_display as string | undefined;
      return amount
        ? `Envie ${amount} para o endereço exibido. Toque em pagar quando estiver pronto.`
        : "Envie o valor em USDC para o endereço abaixo.";
    }
    case "stripe_card":
      return "Preencha os dados do cartão de crédito para finalizar.";
    case "order_confirmation":
      return "Pedido confirmado! Obrigada pela compra.";
    default:
      return null;
  }
}

export function messageToSpeech(msg: { text?: string; blocks?: ChatBlock[] }): string | null {
  const parts: string[] = [];
  if (msg.text) parts.push(msg.text);
  if (msg.blocks) {
    for (const block of msg.blocks) {
      const narration = blockToNarration(block);
      if (narration) parts.push(narration);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}


export function translateShippingLabel(label: string | undefined | null): string {
  if (!label) return "";
  const translations: Record<string, string> = {
    own_delivery_flat: "Entrega própria",
    own_delivery: "Entrega própria",
    correios_pac: "PAC",
    correios_sedex: "Sedex",
    jadlog_package: "Jadlog",
    free_shipping: "Frete grátis",
  };
  if (label.includes("_")) {
    return translations[label] ?? label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return label;
}
