/**
 * Intent classifier — keyword-based intent detection for storefront agent.
 *
 * Routes user messages to specific intent types for hybrid AI gateway routing.
 * Simple, deterministic classification without ML; no external dependencies.
 *
 * Rules:
 * - Contains "buscar/procurar/tem/quero ver" → PRODUCT_SEARCH
 * - Contains "adicionar/colocar/botar no carrinho" → ADD_CART
 * - Contains "comparar/qual melhor/diferença" → COMPARE_PRODUCTS
 * - Contains "desconto/pode fazer/negociar" → NEGOTIATE_PRICE
 * - Contains "recomendar/sugerir/indicar" → RECOMMEND_PERSONALIZED
 * - Contains "pedido/rastrear/status" → ORDER_STATUS
 * - Contains "devolver/trocar/reembolso" → RETURN_REQUEST
 * - Contains "oi/olá/bom dia" → GREETING
 * - Default → COMPLEX_QUESTION
 */

export type StoreAgentIntent =
  | "PRODUCT_SEARCH"
  | "ADD_CART"
  | "COMPARE_PRODUCTS"
  | "NEGOTIATE_PRICE"
  | "RECOMMEND_PERSONALIZED"
  | "ORDER_STATUS"
  | "RETURN_REQUEST"
  | "GREETING"
  | "COMPLEX_QUESTION";

export interface ClassifyIntentResult {
  intent: StoreAgentIntent;
  confidence: number; // 0.0 to 1.0
  matchedKeywords: string[];
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const INTENT_PATTERNS: Array<{
  intent: StoreAgentIntent;
  keywords: RegExp[];
  confidence: number;
}> = [
  {
    intent: "GREETING",
    keywords: [/\b(oi|ola|olá|bom\s+dia|boa\s+tarde|boa\s+noite|e\s+aí)\b/],
    confidence: 1.0
  },
  {
    intent: "PRODUCT_SEARCH",
    keywords: [
      /\b(buscar|procurar|procuro|ta.*tem|voce.*tem|tem.*em|quero\s+ver|me\s+mostra|mostra|vê|ve)\b/,
      /\b(estou\s+procurando|estou\s+com\s+duvida)\b/
    ],
    confidence: 0.95
  },
  {
    intent: "ADD_CART",
    keywords: [
      /\b(adicionar|adiciona|colocar|bota|botar|comprar|quero\s+esse|quero\s+este|leva\s+esse|leva\s+este|levar|pega)\b/,
      /\b(no\s+carrinho|ao\s+carrinho|a\s+compra|para\s+checkout)\b/
    ],
    confidence: 0.95
  },
  {
    intent: "COMPARE_PRODUCTS",
    keywords: [
      /\b(comparar|compara|qual.*melhor|qual\s+eh|qual\s+é|qualidade|diferença|diferenca|qual\s+mais|vantagem|desvantagem)\b/,
      /\b(compara\s+esses?|vs|versus|entre)\b/
    ],
    confidence: 0.9
  },
  {
    intent: "NEGOTIATE_PRICE",
    keywords: [
      /\b(desconto|promocao|promocão|negociar|negocia|pode\s+fazer|consegue\s+fazer|qual\s+o\s+desconto|qual\s+desconto|tem\s+desconto)\b/,
      /\b(mais\s+barato|reduzir\s+preco|reduzir\s+preço|abatimento)\b/
    ],
    confidence: 0.9
  },
  {
    intent: "RECOMMEND_PERSONALIZED",
    keywords: [
      /\b(recomendar|recomenda|sugeri|sugeria|sugerir|indicar|indica|qual\s+voce\s+me|qual\s+você\s+me|qual\s+me\s+acha)\b/,
      /\b(qual\s+eh\s+melhor|qual\s+é\s+melhor|o\s+que\s+voce\s+acha|o\s+que\s+você\s+acha)\b/
    ],
    confidence: 0.85
  },
  {
    intent: "ORDER_STATUS",
    keywords: [
      /\b(pedido|meu\s+pedido|rastrear|rastreio|onde\s+esta|onde\s+está|status|chegar|chegou|que\s+horas|quando\s+chega)\b/,
      /\b(numero\s+do\s+pedido|numero\s+do\s+rastreio|número\s+do\s+pedido|número\s+do\s+rastreio)\b/
    ],
    confidence: 0.95
  },
  {
    intent: "RETURN_REQUEST",
    keywords: [
      /\b(devolver|devolucao|devolução|trocar|troca|reembolso|reembolsar|refund|devolvido|reclamacao|reclamação)\b/,
      /\b(nao\s+gostei|não\s+gostei|veio\s+errado|veio\s+com\s+defeito|com\s+defeito|danificado|quebrado)\b/
    ],
    confidence: 0.9
  }
];

/**
 * Classify the user message into a specific intent.
 *
 * @param message - User message text
 * @returns Classification result with intent, confidence, and matched keywords
 */
export function classifyIntent(message: string): ClassifyIntentResult {
  const normalized = normalize(message);

  // Score each intent based on keyword matches.
  const scores: Array<{ intent: StoreAgentIntent; score: number; keywords: string[] }> = [];

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;
    const matched: string[] = [];

    for (const regex of pattern.keywords) {
      const matches = normalized.match(regex);
      if (matches) {
        score += pattern.confidence / pattern.keywords.length;
        matched.push(...matches);
      }
    }

    if (score > 0) {
      scores.push({
        intent: pattern.intent,
        score: Math.min(score, 1.0),
        keywords: matched
      });
    }
  }

  // Return highest scoring intent, or default to COMPLEX_QUESTION.
  if (scores.length === 0) {
    return {
      intent: "COMPLEX_QUESTION",
      confidence: 0.5,
      matchedKeywords: []
    };
  }

  const best = scores.reduce((max, curr) =>
    curr.score > max.score ? curr : max
  );

  return {
    intent: best.intent,
    confidence: best.score,
    matchedKeywords: [...new Set(best.keywords)]
  };
}

/**
 * Map intent to a model preference for hybrid routing.
 *
 * Fast intents (GREETING, PRODUCT_SEARCH) → use fast model (Sonnet 3.5).
 * Complex intents (COMPLEX_QUESTION, NEGOTIATE_PRICE) → use stronger model (Opus).
 */
export function getModelForIntent(intent: StoreAgentIntent): "fast" | "strong" {
  switch (intent) {
    case "GREETING":
    case "PRODUCT_SEARCH":
    case "ADD_CART":
    case "ORDER_STATUS":
      return "fast";

    case "COMPARE_PRODUCTS":
    case "NEGOTIATE_PRICE":
    case "RECOMMEND_PERSONALIZED":
    case "RETURN_REQUEST":
    case "COMPLEX_QUESTION":
      return "strong";

    default:
      return "fast";
  }
}
