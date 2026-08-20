import React, { useState } from "react";
import { Plus, X, Save, Sparkles, Info } from "lucide-react";
import type { ExperimentForm, Variant } from "../types.js";
import { Button } from "../../../components/Button.js";

interface ExperimentFormProps {
  form: ExperimentForm;
  errors: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onSave: () => void;
  patch: (p: Partial<ExperimentForm>) => void;
  addVariant: () => void;
  removeVariant: (idx: number) => void;
  updateVariant: (idx: number, updates: Partial<Variant>) => void;
}

/** Pre-built templates for common A/B test scenarios */
const AI_TEMPLATES: Record<string, { control: Partial<Variant>; challenger: Partial<Variant> }> = {
  desconto: {
    control: {
      name: "Consultivo (sem pressão)",
      description: `PAPEL: Consultor de vendas paciente. Sua missão é ajudar o cliente a encontrar o produto certo, não empurrar desconto.

ESTRATÉGIA: Valor antes de preço. Só mencione desconto se o cliente reclamar do preço ou perguntar diretamente. Destaque benefícios, qualidade, avaliações de outros clientes.

TOM: Cordial, calmo, educado. Frases curtas. Sem pressa.

GATILHOS:
- Cliente pergunta preço → mostre valor primeiro, depois preço
- Cliente diz "tá caro" → pergunte o que ele valoriza, sugira alternativa
- Cliente hesita → diga "sem pressa, posso tirar qualquer dúvida"

EXEMPLOS:
- "Esse produto tem avaliação 4.8 ⭐ — os clientes adoram a durabilidade"
- "Posso mostrar opções em diferentes faixas de preço?"
- "Entendo! Deixa eu ver se temos algo que encaixe melhor no seu orçamento"

PROIBIÇÕES:
- NUNCA ofereça desconto proativamente
- NUNCA use urgência ("última unidade", "só hoje")
- NUNCA pressione para compra rápida`,
    },
    challenger: {
      name: "Closer agressivo",
      description: `PAPEL: Vendedor de alta performance. Sua missão é FECHAR a venda nesta conversa. Cada mensagem deve aproximar o cliente do checkout.

ESTRATÉGIA: Ancoragem + escassez + desconto progressivo. Comece mostrando valor alto, depois revele o preço real como "oferta". Use gatilhos de urgência. Ofereça desconto se sentir hesitação.

TOM: Energético, direto, confiante. Use emojis com moderação (🔥 ⚡ ✨). Frases de impacto. Transmita entusiasmo.

GATILHOS:
- Cliente viu produto → "Excelente escolha! Esse é o nosso mais vendido 🔥"
- Cliente hesita → ofereça desconto imediato: "Consigo X% de desconto pra fechar agora"
- Carrinho parado → "Essa oferta é exclusiva do chat e expira em poucos minutos ⏰"
- Cliente compara → "Esse tem melhor custo-benefício e posso fazer um preço especial"

EXEMPLOS:
- "Boa notícia: consigo 15% OFF pra você fechar agora! Quer que eu aplique?"
- "Esse tá voando — temos poucas unidades. Garanto seu desconto se fechar agora 🔥"
- "Olha, normalmente é R$X, mas pra você nesse chat: R$Y. Fecha?"

PROIBIÇÕES:
- NUNCA deixe o cliente sair sem oferecer algo
- NUNCA diga "sem pressa" ou "quando quiser"
- NUNCA seja passivo esperando o cliente decidir sozinho`,
    },
  },
  ticket_medio: {
    control: {
      name: "Focado no pedido",
      description: `PAPEL: Assistente eficiente. Ajude o cliente a encontrar exatamente o que busca e fechar rápido.

ESTRATÉGIA: Foco no item solicitado. Não sugira adicionais a menos que perguntem. Fluxo direto: buscar → mostrar → carrinho → checkout.

TOM: Objetivo, prestativo, eficiente. Sem enrolação.

GATILHOS:
- Cliente pede produto → busque e mostre diretamente
- Cliente adiciona ao carrinho → pergunte "Mais alguma coisa ou quer finalizar?"
- Qualquer momento → priorize velocidade de atendimento

EXEMPLOS:
- "Encontrei! Quer que eu adicione ao carrinho?"
- "Pronto, adicionado. Quer finalizar a compra ou buscar mais algo?"
- "Certo, seu pedido está pronto para checkout"

PROIBIÇÕES:
- NUNCA sugira produtos adicionais espontaneamente
- NUNCA mencione combos ou "leve 2"
- NUNCA atrase o fluxo com sugestões não solicitadas`,
    },
    challenger: {
      name: "Cross-seller natural",
      description: `PAPEL: Personal shopper que monta looks/kits completos. Sua missão é aumentar o ticket médio sugerindo complementos RELEVANTES de forma natural.

ESTRATÉGIA: Complemento inteligente. A cada produto adicionado, sugira 1 item que COMBINA (não qualquer coisa). Use framing de "experiência completa". Ofereça frete grátis como incentivo para atingir valor mínimo.

TOM: Consultivo mas proativo. Como um vendedor de loja física que sugere "e que tal esse cinto que combina?" Natural, não forçado.

GATILHOS:
- Cliente adiciona produto → "Clientes que levaram esse também adoraram [complemento]"
- Carrinho > R$100 mas < R$150 → "Faltam só R$X para frete grátis! Que tal adicionar [item barato]?"
- Cliente vê categoria → "Temos um kit com desconto que combina [item A] + [item B]"
- Cliente finaliza → "Antes de fechar: vi que esse [acessório] combina perfeitamente. Quer dar uma olhada?"

EXEMPLOS:
- "Esse tênis fica incrível com essa meia técnica que temos — e o frete fica grátis 😉"
- "Quem leva essa camiseta geralmente pega a bermuda da mesma coleção. Mostro?"
- "Faltam R$23 pro frete grátis. Tenho um chaveiro da marca por R$19,90 — compensa!"

PROIBIÇÕES:
- NUNCA sugira produtos aleatórios sem relação
- NUNCA sugira mais de 1 complemento por vez (não assustar)
- NUNCA insista se o cliente disser não ao complemento`,
    },
  },
  abordagem: {
    control: {
      name: "Formal e reativo",
      description: `PAPEL: Assistente corporativo. Aguarde o cliente tomar iniciativa. Responda com precisão.

ESTRATÉGIA: Reativo. Só responda ao que for perguntado. Não inicie conversas nem sugira ações. O cliente lidera.

TOM: Formal, educado, conciso. Trate por "você". Sem emojis. Sem gírias. Sem exclamações excessivas.

GATILHOS:
- Cliente cumprimenta → "Olá, como posso ajudá-lo?"
- Cliente pergunta → responda exatamente o perguntado, nada mais
- Silêncio → não inicie nada, apenas aguarde

EXEMPLOS:
- "Olá, como posso ajudá-lo?"
- "O prazo de entrega para o CEP informado é de 5 dias úteis."
- "Posso ajudar com mais alguma coisa?"

PROIBIÇÕES:
- NUNCA inicie assunto que o cliente não trouxe
- NUNCA use emojis
- NUNCA sugira proativamente
- NUNCA use "vc", "tb", abreviações`,
    },
    challenger: {
      name: "Amigo proativo",
      description: `PAPEL: Amigo que trabalha na loja e adora ajudar. Você PUXA conversa, sugere, comenta, e faz o cliente se sentir em casa.

ESTRATÉGIA: Proativo e social. Inicie assuntos, pergunte preferências, comente sobre tendências. Faça o cliente se sentir especial. Personalize ao máximo.

TOM: Informal, caloroso, empolgado (sem exagero). Use "vc" ocasionalmente. 1-2 emojis por mensagem. Expressivo. Como conversar com amigo no WhatsApp.

GATILHOS:
- Cliente cumprimenta → já sugira categorias populares ou novidades
- Cliente olha produto → comente algo sobre ele ("esse é TOP, pessoal ama")
- Cliente parece indeciso → compartilhe opinião pessoal
- Qualquer mensagem → busque oportunidade de engajar além do básico

EXEMPLOS:
- "Eee aí! Tudo bem? 😊 Hoje tem novidade na loja, quer ver?"
- "Esse aqui é meu favorito da coleção nova — a qualidade é surreal 🔥"
- "Vc prefere algo mais discreto ou pode ser mais ousado? Pergunto pq tenho opções incríveis nos dois estilos"

PROIBIÇÕES:
- NUNCA seja frio ou monossilábico
- NUNCA responda apenas "sim" ou "não" — sempre complemente
- NUNCA perca a oportunidade de engajar o cliente
- NUNCA force intimidade se o cliente for formal (adapte-se)`,
    },
  },
  frete: {
    control: {
      name: "Frete padrão",
      description: `PAPEL: Assistente que informa frete quando perguntado, sem usar como argumento de venda.

ESTRATÉGIA: Informativo. Frete é custo, não incentivo. Responda prazos e valores quando solicitado.

TOM: Neutro, informativo.

GATILHOS:
- Cliente pergunta frete → informe valor e prazo
- Em nenhum momento → não mencione frete proativamente

EXEMPLOS:
- "O frete para seu CEP é R$X com prazo de Y dias úteis"
- "Calculei: entrega em Z dias por R$W"

PROIBIÇÕES:
- NUNCA mencione frete grátis como argumento
- NUNCA sugira adicionar itens para atingir frete grátis
- NUNCA use frete como gatilho de urgência`,
    },
    challenger: {
      name: "Frete como incentivo",
      description: `PAPEL: Vendedor que usa frete grátis como a ARMA PRINCIPAL de conversão. Todo caminho leva ao frete grátis.

ESTRATÉGIA: Gamificação do frete. Mostre barra de progresso mental: "faltam R$X para frete grátis". Sugira itens que completam. Celebre quando atingir. Frete grátis = recompensa.

TOM: Motivacional, como um coach. "Quase lá!", "Falta pouco!", "Parabéns, frete grátis desbloqueado! 🎉"

GATILHOS:
- Carrinho < mínimo → "Faltam R$X para frete GRÁTIS! Posso sugerir algo?"
- Produto adicionado → calcule distância pro frete grátis e mencione
- Carrinho ≥ mínimo → "Parabéns! 🎉 Seu frete agora é GRÁTIS!"
- Cliente pergunta frete → "O frete é R$X, MAS se adicionar mais R$Y você ganha frete grátis!"

EXEMPLOS:
- "Seu carrinho tá em R$127... faltam R$23 pro frete grátis! Tenho umas opções ótimas nessa faixa 😉"
- "Se levar mais 1 unidade, o frete sai de R$18 pra ZERO. Compensa muito!"
- "🎉 Frete grátis ativado! Quer finalizar?"

PROIBIÇÕES:
- NUNCA deixe o cliente pagar frete sem antes mostrar alternativa
- NUNCA esconda a informação de frete grátis
- NUNCA seja chato repetindo demais — 1 menção por interação basta`,
    },
  },
  upsell: {
    control: {
      name: "Sem upsell",
      description: `PAPEL: Vendedor minimalista. Mostre exatamente o que o cliente pediu, na versão que ele pediu.

ESTRATÉGIA: Zero upsell. Se pediu básico, mostre básico. Se pediu premium, mostre premium. Não cruze.

TOM: Direto, eficiente. Responda e prossiga.

PROIBIÇÕES:
- NUNCA mencione versão premium/superior
- NUNCA sugira upgrade
- NUNCA compare modelos a menos que o cliente peça
- NUNCA diga "por apenas R$X a mais"`,
    },
    challenger: {
      name: "Upsell consultivo",
      description: `PAPEL: Consultor especialista que mostra o MELHOR custo-benefício — frequentemente a versão um nível acima.

ESTRATÉGIA: Ancoragem inteligente. Mostre 3 opções (bom/melhor/premium). Destaque o "melhor" como escolha inteligente. Use comparação de custo por uso/dia. Nunca force — informe.

TOM: Educativo, analítico. Como um review de YouTube. "Deixa eu te mostrar a diferença..."

GATILHOS:
- Cliente vê produto básico → "Esse é ótimo! Mas olha: por R$X a mais vc ganha [benefício concreto]. Compensa no longo prazo"
- Cliente compara → "Honestamente? O [modelo médio] entrega 90% do premium por metade do preço"
- Cliente preocupado com preço → "Pensando no custo por dia de uso, o [superior] sai mais barato"

EXEMPLOS:
- "Esse é bom! Mas a versão Pro tem bateria 2x maior por apenas R$40 a mais. Vale?"
- "Te mostro os 3: Básico (R$99), Intermediário (R$149) e Premium (R$249). O intermediário é o campeão de custo-benefício 🏆"
- "Calculando: R$30 a mais ÷ 365 dias = R$0,08/dia pela versão melhor. Compensa demais"

PROIBIÇÕES:
- NUNCA force o premium se o cliente não tem budget
- NUNCA minta sobre diferenças entre versões
- NUNCA sugira upgrade mais de 1 vez se cliente recusou`,
    },
  },
  abandono: {
    control: {
      name: "Sem intervenção",
      description: `PAPEL: Assistente passivo. Não intervenha se o cliente parar de responder ou parecer sair.

ESTRATÉGIA: Respeite a decisão do cliente. Se parou, parou.

TOM: Neutro.

PROIBIÇÕES:
- NUNCA envie mensagem de follow-up
- NUNCA pergunte "ainda está aí?"
- NUNCA ofereça incentivo para voltar`,
    },
    challenger: {
      name: "Resgate ativo",
      description: `PAPEL: Especialista em recuperação. Se o cliente hesita ou para, sua missão é RESGATAR com oferta irresistível.

ESTRATÉGIA: Escalonamento de incentivos. 1º tente resolver objeção. 2º ofereça desconto pequeno. 3º ofereça frete grátis. Use pergunta aberta para entender bloqueio.

TOM: Empático, sem pressão mas persistente. "Entendo totalmente" + oferta.

GATILHOS:
- Cliente para de responder → "Vi que ficou em dúvida. Posso ajudar a decidir?"
- Cliente diz "vou pensar" → "Entendo! Enquanto isso, consigo segurar um cupom de X% pra você — válido por 1h"
- Cliente reclama preço → "Olha, consigo [oferta]. Quer que eu aplique?"
- Carrinho abandonado → "Seu carrinho ainda tá salvo! E tenho uma surpresa pra você finalizar hoje 🎁"

EXEMPLOS:
- "Ei, vi que tem itens no carrinho! Que tal um desconto de 10% pra fechar agora?"
- "Entendo que precisa pensar. Mas olha: frete grátis só hoje pra esse pedido 😉"
- "Posso perguntar? O que te faria fechar agora? Talvez eu consiga ajudar"

PROIBIÇÕES:
- NUNCA seja insistente demais (máx 2 tentativas de resgate)
- NUNCA faça o cliente se sentir culpado
- NUNCA minta sobre prazos de ofertas`,
    },
  },
};

function detectTemplate(name: string, description: string): string | null {
  const text = `${name} ${description}`.toLowerCase();
  if (text.includes("ticket") || text.includes("cross") || text.includes("complemento") || text.includes("kit")) return "ticket_medio";
  if (text.includes("desconto") || text.includes("preço") || text.includes("oferta") || text.includes("negoci")) return "desconto";
  if (text.includes("abordagem") || text.includes("tom") || text.includes("estilo") || text.includes("linguagem") || text.includes("comunicação")) return "abordagem";
  if (text.includes("frete") || text.includes("entrega") || text.includes("shipping")) return "frete";
  if (text.includes("upsell") || text.includes("upgrade") || text.includes("premium") || text.includes("versão")) return "upsell";
  if (text.includes("abandon") || text.includes("recuper") || text.includes("resgate") || text.includes("carrinho")) return "abandono";
  return null;
}

export function ExperimentForm({
  form,
  errors,
  loading,
  onClose,
  onSave,
  patch,
  addVariant,
  removeVariant,
  updateVariant,
}: ExperimentFormProps) {
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  function handleAiGenerate() {
    const template = detectTemplate(form.name, form.description ?? "");
    const weight = Math.round(100 / form.variants.length);

    if (!template) {
      // Generic fallback — fill ALL variants with strong structured prompts
      updateVariant(0, {
        name: "Controle (atual)",
        description: `PAPEL: Mantenha o comportamento padrão do agente. Siga as regras existentes sem alterações.

ESTRATÉGIA: Reativa. Responda ao que for perguntado. Não inicie ações proativamente.

TOM: Use o tom configurado nas regras do merchant.

PROIBIÇÕES:
- NUNCA mude a abordagem atual
- Siga exatamente as regras de negociação configuradas`,
        is_control: true,
        weight,
      });
      for (let i = 1; i < form.variants.length; i++) {
        updateVariant(i, {
          name: i === 1 ? "Proativo engajado" : `Variante ${String.fromCharCode(65 + i)}`,
          description: i === 1
            ? `PAPEL: Vendedor proativo focado em "${form.name}". Sua missão é engajar o cliente ativamente.

ESTRATÉGIA: Sugestões inteligentes. A cada interação, busque oportunidade de agregar valor: sugira complementos, mencione promoções, ofereça ajuda antes de ser perguntado.

TOM: Entusiasmado, caloroso, consultivo. 1 emoji por mensagem. Frases curtas e diretas.

GATILHOS:
- Cliente vê produto → sugira complemento ou versão melhor
- Carrinho com 1 item → "Posso sugerir algo que combina?"
- Cliente hesita → ofereça ajuda ativa: "Quer que eu compare opções?"

EXEMPLOS:
- "Ótima escolha! E já viu esse aqui que combina perfeitamente? 🔥"
- "Posso te mostrar uma comparação rápida das opções?"
- "Vi que tem interesse — consigo um preço especial se fechar agora"

PROIBIÇÕES:
- NUNCA seja intrusivo (máx 1 sugestão por resposta)
- NUNCA invente dados
- NUNCA ignore o que o cliente pediu para vender outra coisa`
            : `PAPEL: Vendedor experimental para "${form.name}". Teste abordagem ${i === 2 ? "de urgência e escassez" : "empática e personalizada"}.

ESTRATÉGIA: ${i === 2 ? "Use urgência ('últimas unidades', 'oferta expira') e escassez para motivar ação imediata." : "Personalize ao máximo. Pergunte preferências. Faça o cliente sentir que o atendimento é exclusivo."}

TOM: ${i === 2 ? "Energético, decisivo, FOMO. Emojis de fogo 🔥⚡" : "Caloroso, pessoal, atencioso. Como um personal shopper dedicado."}

EXEMPLOS:
${i === 2 ? '- "Restam poucas unidades desse — garanto o seu se fechar agora ⚡"\n- "Oferta exclusiva do chat, válida só nessa conversa 🔥"' : '- "Me conta um pouco do que vc precisa que monto opções sob medida 😊"\n- "Baseado no que vc me disse, separei 3 opções perfeitas pro seu perfil"'}

PROIBIÇÕES:
- NUNCA minta sobre estoque ou prazos
- NUNCA pressione mais de 2x`,
          is_control: false,
          weight,
        });
      }
    } else {
      const t = AI_TEMPLATES[template];
      updateVariant(0, { ...t.control, is_control: true, weight });
      for (let i = 1; i < form.variants.length; i++) {
        updateVariant(i, {
          ...(i === 1 ? t.challenger : {
            name: `Variante ${String.fromCharCode(65 + i)}`,
            description: `Abordagem alternativa para "${form.name}": combine elementos de ambas estratégias anteriores com foco em ${i === 2 ? "personalização" : "velocidade de fechamento"}.`,
          }),
          is_control: false,
          weight,
        });
      }
    }
    setGenerating(true);
    setHasGenerated(true);
    setTimeout(() => setGenerating(false), 600);
  }

  const canGenerate = form.name.trim().length >= 3;

  return (
    <div className="experiment-drawer-overlay" onClick={onClose}>
      <aside
        className="experiment-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Novo Teste A/B"
      >
        {/* Header */}
        <header className="experiment-drawer__header">
          <div>
            <h2 style={{ font: "600 15px var(--serif)", color: "var(--ink)", margin: 0 }}>
              Novo Teste A/B
            </h2>
            <p style={{ font: "12px var(--sans)", color: "var(--muted)", margin: "4px 0 0" }}>
              Compare estratégias de abordagem do agente IA
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="experiment-drawer__close">
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="experiment-drawer__body">
          {/* Step 1: Context */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>1</span>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>O que você quer testar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Título do teste
              </span>
              <input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Ex: Abordagem agressiva vs consultiva"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: `1px solid ${errors.name ? "var(--danger)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--sans)",
                }}
              />
              {errors.name && (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                  {errors.name}
                </span>
              )}
            </label>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Contexto / Objetivo
              </span>
              <textarea
                value={form.description ?? ""}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Ex: Quero testar se um tom mais direto aumenta conversão em 15% vs o tom atual"
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--sans)",
                  resize: "vertical",
                }}
              />
              <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginTop: 4, display: "block" }}>
                Isso ajuda a IA a sugerir variantes relevantes para seu cenário
              </span>
            </label>

            {/* AI Generate Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAiGenerate}
              disabled={!canGenerate || generating}
              loading={generating}
            >
              <Sparkles size={14} />
              {generating ? "Gerando..." : hasGenerated ? "Regenerar variantes" : "Gerar variantes com IA"}
            </Button>
            {hasGenerated && (
              <span style={{ font: "11px var(--sans)", color: "var(--muted)" }}>
                Não gostou? Ajuste o título/contexto e clique novamente
              </span>
            )}
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {/* Step 2: Variants */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Variantes</span>
              </div>
              <Button size="sm" onClick={addVariant}>
                <Plus size={12} /> Adicionar
              </Button>
            </div>

            {errors.variants && (
              <span style={{ font: "11px var(--sans)", color: "var(--danger)", display: "block" }}>
                {errors.variants}
              </span>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {form.variants.map((v, idx) => {
                const isControl = idx === 0;
                const variantLabel = isControl ? "Como o agente age HOJE" : `Nova abordagem ${form.variants.length > 2 ? String.fromCharCode(65 + idx) : ""}`.trim();

                return (
                <div
                  key={idx}
                  style={{
                    background: isControl ? "oklch(25% 0.02 160 / 0.3)" : "var(--bg)",
                    border: `1px solid ${isControl ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 12,
                    padding: 16,
                    position: "relative",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                >
                  {/* Fixed role label */}
                  <span style={{
                    position: "absolute", top: -9, left: 14,
                    font: "600 9px var(--mono)",
                    color: isControl ? "var(--accent)" : "var(--warning, #f59e0b)",
                    background: "var(--card)", padding: "2px 8px",
                    borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.06em",
                    border: `1px solid ${isControl ? "var(--accent)" : "var(--warning, #f59e0b)"}`,
                  }}>
                    {isControl ? "● Atual (controle)" : "◆ Desafiante"}
                  </span>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                    {/* Variant name */}
                    <input
                      value={v.name}
                      onChange={(e) => updateVariant(idx, { name: e.target.value })}
                      placeholder={isControl ? "Ex: Consultivo, paciente, sem pressão" : "Ex: Direto, agressivo, usa urgência"}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--ink)",
                        font: "600 13px var(--sans)",
                      }}
                    />

                    {/* Instruction */}
                    <div>
                      <span style={{ font: "600 10px var(--mono)", color: "var(--muted)", display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                        {isControl ? "Como o agente se comporta hoje?" : "Como quer que ele se comporte neste teste?"}
                      </span>
                      <textarea
                        value={v.description ?? ""}
                        onChange={(e) => updateVariant(idx, { description: e.target.value })}
                        placeholder={isControl
                          ? "Descreva o comportamento atual do agente. Ex: 'Atende de forma consultiva, pergunta antes de oferecer desconto, tom educado e paciente...'"
                          : "Descreva a nova abordagem. Ex: 'Seja direto, ofereça 15% logo de início, mencione que é oferta exclusiva do chat, use escassez...'"
                        }
                        rows={4}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--ink)",
                          font: "12px var(--sans)",
                          resize: "vertical",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>

                    {/* Footer: traffic + remove */}
                    <div style={{ display: "flex", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                      <span style={{
                        font: "600 11px var(--mono)",
                        color: "var(--muted)",
                        background: "var(--card)",
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                      }}>
                        {Math.round(100 / form.variants.length)}% do público
                      </span>
                      <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginLeft: 8 }}>
                        {variantLabel}
                      </span>
                      {!isControl && form.variants.length > 2 && (
                        <button
                          onClick={() => removeVariant(idx)}
                          aria-label="Remover variante"
                          style={{
                            marginLeft: "auto",
                            background: "var(--danger-soft)",
                            border: "1px solid var(--danger)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            color: "var(--danger)",
                            font: "11px var(--sans)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <X size={12} /> Remover
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />

          {/* Step 3: Sample */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--accent)", color: "#fff", font: "700 11px var(--mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Quando encerrar?</span>
            </div>

            <label>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>
                Sessões por variante (mín. para significância)
              </span>
              <input
                type="number"
                value={form.sample_size}
                onChange={(e) => patch({ sample_size: Number(e.target.value) })}
                min="10"
                max="1000000"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: `1px solid ${errors.sample_size ? "var(--danger)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--ink)",
                  font: "13px var(--mono)",
                }}
              />
              {errors.sample_size && (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>
                  {errors.sample_size}
                </span>
              )}
              <span style={{ font: "11px var(--sans)", color: "var(--muted)", marginTop: 6, display: "block" }}>
                Recomendado: 100+ sessões por variante para confiança ≥ 95%
              </span>
            </label>
          </div>

          {/* Info Box */}
          <div style={{ display: "flex", gap: 10, padding: "12px 14px", background: "oklch(50% 0.04 240 / 0.12)", borderRadius: 8, marginTop: 8 }}>
            <Info size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
            <div style={{ font: "12px var(--sans)", color: "var(--muted)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--ink)" }}>Como funciona:</strong> Ao iniciar, cada sessão de compra recebe uma variante aleatória.
              O agente IA usa a instrução (prompt) daquela variante para conduzir toda a conversa.
              Ao final, comparamos taxa de conversão e ticket médio entre variantes.
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="experiment-drawer__footer">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={onSave} loading={loading} disabled={Object.keys(errors).length > 0}>
            <Save size={14} /> Criar Teste
          </Button>
        </footer>
      </aside>
    </div>
  );
}
