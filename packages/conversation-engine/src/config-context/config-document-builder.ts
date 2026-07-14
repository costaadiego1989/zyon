/**
 * Config Document Builder — compiles ALL merchant configs into a structured markdown document.
 *
 * Output format is optimized for LLM consumption: clear sections, markdown structure,
 * guardrails always included (hardcoded safety rules + custom).
 *
 * SENSITIVE DATA FILTERING: Never embed API keys, passwords, or tokens.
 */

import type { ConfigSources, ConfigEmbeddingRepository } from "./config-embedding-repository.js";

export interface MerchantConfigDocument {
  merchantId: string;
  documentText: string;
  version: number;
  generatedAt: Date;
  sections: {
    identity: string;
    appearance: string;
    behavior: string;
    negotiation: string;
    faq: string;
    guardrails: string;
    badges: string;
  };
}

export class ConfigDocumentBuilder {
  private version = 0;

  constructor(private readonly repository: ConfigEmbeddingRepository) {}

  async build(sources: ConfigSources): Promise<MerchantConfigDocument> {
    this.version += 1;

    const sections = {
      identity: this.buildIdentity(sources),
      appearance: this.buildAppearance(sources),
      behavior: this.buildBehavior(sources),
      negotiation: this.buildNegotiation(sources),
      faq: this.buildFaq(sources),
      guardrails: this.buildGuardrails(sources),
      badges: this.buildBadges(sources)
    };

    const documentText = [
      `# Contexto do Merchant: ${sources.storeName}`,
      "",
      "## Identidade",
      sections.identity,
      "",
      "## Aparência",
      sections.appearance,
      "",
      "## Comportamento do Agente",
      sections.behavior,
      "",
      "## Regras de Negociação",
      sections.negotiation,
      "",
      "## FAQ",
      sections.faq,
      "",
      "## Guardrails (NUNCA violar)",
      sections.guardrails,
      "",
      "## Selos de Confiança",
      sections.badges
    ]
      .filter((line) => line !== null && line !== undefined)
      .join("\n")
      .trim();

    return {
      merchantId: sources.merchantId,
      documentText,
      version: this.version,
      generatedAt: new Date(),
      sections
    };
  }

  private buildIdentity(sources: ConfigSources): string {
    const lines = [
      `- Nome do assistente: ${this.sanitize(sources.theme.agentName || "Assistente")}`,
      `- Loja: ${this.sanitize(sources.storeName)}`,
      `- Plataforma: ${this.sanitize(sources.provider)} (${this.sanitize(sources.storeUrl)})`
    ];
    return lines.join("\n");
  }

  private buildAppearance(sources: ConfigSources): string {
    const lines = [
      `- Cor principal: ${sources.theme.accentColor || "#0F766E"}`,
      `- Cor secundária: ${sources.theme.secondaryColor || "#1E40AF"}`,
      `- Cor de texto: ${sources.theme.textColor || "#111827"}`,
      `- Cor de fundo: ${sources.theme.backgroundColor || "#F7F8FA"}`,
      `- Fonte: ${this.sanitize(sources.theme.fontFamily || "Inter")}`,
      `- Estilo: ${this.sanitize(sources.theme.density || "comfortable")}`
    ];
    return lines.join("\n");
  }

  private buildBehavior(sources: ConfigSources): string {
    const lines = [
      `- Modo: ${this.sanitize(sources.settings.mode)} (${this.modeDescription(sources.settings.mode)})`,
      `- Máx intervenções por sessão: ${sources.settings.maxInterventionsPerSession}`,
      `- Cooldown: ${sources.settings.cooldownSeconds}s`,
      `- Abrir widget nos gatilhos: ${sources.settings.openWidgetOnTrigger ? "Sim" : "Não"}`
    ];
    return lines.join("\n");
  }

  private buildNegotiation(sources: ConfigSources): string {
    const lines = [
      `- Desconto máximo: ${sources.policy.maxDiscountPercent}%`,
      `- Oferta mínima do comprador: ${sources.policy.minOfferDiscountPercent}%`,
      `- Margem mínima: ${sources.rules.minimumMarginPercent}%`,
      `- Máx rodadas: ${sources.policy.maxRounds}`,
      `- Custo máximo IA: R$${((sources.policy.maxAiCostCents || 0) / 100).toFixed(2)}`
    ];
    return lines.join("\n");
  }

  private buildFaq(sources: ConfigSources): string {
    if (sources.faq.length === 0) {
      return "(Nenhuma FAQ configurada ainda)";
    }
    return sources.faq
      .map((q) => `P: ${this.sanitize(q.question)}\nR: ${this.sanitize(q.answer)}`)
      .join("\n\n");
  }

  private buildGuardrails(sources: ConfigSources): string {
    // Hardcoded safety invariants (per CLAUDE.md critical invariants).
    const hardcoded = [
      "- NÃO autorizar descontos sem rules-engine",
      "- NÃO prometer frete grátis sem shipping-engine",
      "- NÃO confirmar pagamento sem webhook",
      "- NÃO pedir CVV, senha ou dados sensíveis",
      "- NÃO garantir estoque sem verificação",
      "- NÃO mentir sobre prazo de entrega"
    ];

    // Append custom merchant guardrails.
    const custom = sources.customGuardrails.map((g) => `- ${this.sanitize(g)}`);

    return [...hardcoded, ...custom].join("\n");
  }

  private buildBadges(sources: ConfigSources): string {
    if (!sources.theme.trustBadges || sources.theme.trustBadges.length === 0) {
      return "(Nenhum selo configurado)";
    }
    return sources.theme.trustBadges.map((b) => this.sanitize(b)).join(", ");
  }

  private modeDescription(mode: string): string {
    const map: Record<string, string> = {
      silent_until_trigger: "Silencioso até ativação",
      proactive: "Proativo",
      manual_only: "Manual apenas"
    };
    return map[mode] || mode;
  }

  /**
   * Sanitize text: remove API keys, passwords, and sensitive patterns.
   */
  private sanitize(text: string): string {
    if (!text || typeof text !== "string") return "";
    // Remove common API key patterns.
    return text
      .replace(/sk_live_[a-z0-9]{8,}/gi, "[API_KEY_REDACTED]")
      .replace(/sk_test_[a-z0-9]{8,}/gi, "[API_KEY_REDACTED]")
      .replace(/pk_live_[a-z0-9]{8,}/gi, "[API_KEY_REDACTED]")
      .replace(/or-[a-z0-9]{32,}/gi, "[API_KEY_REDACTED]")
      .replace(/password[=:][^\s]+/gi, "password=[REDACTED]")
      .replace(/token[=:][^\s]+/gi, "token=[REDACTED]");
  }
}
