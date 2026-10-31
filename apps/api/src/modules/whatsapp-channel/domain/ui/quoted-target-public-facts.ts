/** Structural subset of GetProductContentUseCase's public blocks DTO. No
 * application-layer dependency, private metadata, testimonials or costs. */
export interface PublicTargetContentBlock {
  readonly id: string;
  readonly productId: string;
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly order: number;
  readonly isEnabled: boolean;
  readonly locale: string;
}

export interface PublicTargetFactsInput {
  readonly productId: string;
  readonly variantId: string;
  readonly description?: string | null;
  readonly variantAttributes?: Readonly<Record<string, string>> | null;
  readonly publicBlocks?: readonly PublicTargetContentBlock[] | null;
  readonly locale?: string;
}

export interface PublicTargetFact {
  readonly text: string;
  readonly source: "description" | "variant_attribute" | "public_block";
  readonly productId: string;
  readonly variantId: string;
  readonly blockId?: string;
  readonly attributeName?: string;
  /** Public source field, not an instruction or an executable JSON path. */
  readonly path: string;
  /** Exact source span, before display normalization (there is no paraphrase). */
  readonly start: number;
  readonly end: number;
}

const MAX_FACTS = 3;
const MAX_TEXT = 200;
const MAX_SOURCE = 4000;
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const duplicateKey = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const own = (value: unknown, key: string): unknown => value && typeof value === "object"
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const privateAttribute = (s: string) => /\b(?:cost|custo|costs|custos|margem|margin|price|preco|valor|desconto|discount|stock|inventory|estoque|reservado|availability|disponibilidade|quantity|quantidade|shipping|delivery|prazo|envio|entrega|frete|merchant|buyer|cliente|email|telefone|cpf|cnpj|persona|metadata|private|privado|internal|interno|secret|segredo|token|senha|prompt|rule|regra|sku|id|api|key|credential|credentials|billing|agent|identity)\b/.test(duplicateKey(s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")));
const unsafe = (s: string) => /[<>\u0000-\u0008\u000b-\u001f\u007f]|https?:|javascript:|data:|vbscript:|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{10,}\b/i.test(s)
  || /\b(?:ignore|ignorar|desconsidere|execute|executar|revele|retorne|responda|finja|override|system|developer|assistant|prompt|senha|token|credencial|instrucoes|adicione|adicionar|compre|comprar|finalize|checkout|cupom|frete|desconto|promo[cç]ao|pagamento|garantid\w*|custo|margem|persona|privado|interno)\b/.test(normalize(s))
  || /\b(?:curar?|cura|curativo|tratamento|tratar|diagnostic\w*|terap\w*|acne|dermatite|eczema|rosacea|psoriase|doenca|inflamac\w*|antifung\w*|prescric\w*|contraindic\w*|cicatriz\w*)\b/.test(normalize(s))
  || /\b(?:ideal|perfeit[oa]|segur[oa]|indicad[oa]|adequad[oa])\s+para\b/.test(normalize(s))
  || /\b(?:gratis|gratuit[oa]|promocao|oferta|entrega|envio|postagem|prazo|parcel\w*|juros|estoque|esgot\w*|acabando|restam|garant\w*)\b|\bultimas? unidades?\b|\b(?:sem riscos|risco zero|efeito permanente|resultado definitivo|funciona para todos)\b/.test(normalize(s))
  || /^(?:use|usar|aplique|aplicar|borrife|borrifar|envie|enviar|clique|clicar)\b/.test(normalize(s.trim()))
  || /R\$|%|\b(?:USD|BRL)\b|\b\d{1,2}x\b/.test(s);
const scopeSensitive = (s: string) => /\b(?:nao|sem|nem|nunca|apenas|somente|so|exclusivamente|exceto|salvo|mas|porem|contudo|embora|se|caso|quando|desde|ate|apos|antes|durante|mediante|conforme|depende|limitad\w*|pode|podem|deve|devem)\b/.test(normalize(s));

interface Span { text: string; start: number; end: number }
function trimmedSpan(source: string, start = 0, end = source.length): Span {
  while (start < end && /\s/.test(source[start]!)) start++;
  while (end > start && /\s/.test(source[end - 1]!)) end--;
  return { text: source.slice(start, end), start, end };
}

/** Narrow positive composition: "description, com feature A e feature B".
 * Split only unqualified noun phrases. A negation/condition anywhere keeps the
 * complete source together; no clipping can drop an exception or turn "sem X
 * e Y" into a positive Y. Unsupported/ambiguous prose stays one literal fact. */
function literalSpans(source: string): Span[] {
  const whole = trimmedSpan(source);
  if (scopeSensitive(source) || /[;:!?\n]/.test(source)) return [whole];
  const match = /^(.*?),\s+com\s+([^,.]+?)\s+e\s+([^,.]+?)([.]?)\s*$/u.exec(source);
  if (!match) return [whole];
  const descriptive = (s: string) => {
    const words = s.trim().split(/\s+/);
    return words.length >= 2 && words.length <= 7 && /^[\p{L}\p{N}'’ -]+$/u.test(s)
      && !/\b(?:e|ou|com|para|por|que|de|do|da|dos|das|um|uma|ser|estar|ter|usar|aplicar|melhor|mais|menos)\b/.test(normalize(s));
  };
  if (!descriptive(match[2]!) || !descriptive(match[3]!) || /[,.]/.test(match[1]!)) return [whole];
  const first = trimmedSpan(source, 0, match[1]!.length);
  const secondStart = source.indexOf(match[2]!, first.end);
  const thirdStart = source.lastIndexOf(match[3]!);
  return [first, trimmedSpan(source, secondStart, secondStart + match[2]!.length),
    trimmedSpan(source, thirdStart, thirdStart + match[3]!.length)];
}

/** Caller must FIRST bind a current active product and its exact active variant
 * to the quote and authenticated merchant. This pure projection cannot perform
 * that catalog lookup. It reads only those supplied public fields and never
 * treats catalog prose as instructions or infers medical/personal suitability. */
export function extractSafeTargetFacts(input: PublicTargetFactsInput): PublicTargetFact[] {
  if (!input.productId || !input.variantId || input.productId.length > 191 || input.variantId.length > 191) return [];
  const locale = (input.locale ?? "pt-BR").replace(/_/g, "-").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z]{2}|-\d{3})?$/.test(locale)) return [];
  const facts: PublicTargetFact[] = [];
  const seen = new Set<string>();
  const add = (source: unknown, origin: Omit<PublicTargetFact, "text" | "start" | "end" | "productId" | "variantId">) => {
    if (typeof source !== "string" || source.length > MAX_SOURCE || unsafe(source)) return;
    for (const span of literalSpans(source)) {
      const key = duplicateKey(span.text);
      if (span.text.length < 8 || span.text.length > MAX_TEXT || !key || seen.has(key)) continue;
      seen.add(key); facts.push({ ...origin, ...span, productId: input.productId, variantId: input.variantId });
      if (facts.length === MAX_FACTS) break;
    }
  };
  // Enabled content is already public, but repeat target/locale checks before
  // reading its props. Never scan source-product blocks or arbitrary metadata.
  const blocks = Array.isArray(input.publicBlocks) ? input.publicBlocks.filter(b => b && typeof b === "object") : [];
  for (const b of blocks.slice(0, 100).sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0))) {
    if (facts.length === MAX_FACTS) break;
    if (!b.id || b.productId !== input.productId || b.isEnabled !== true || typeof b.locale !== "string" || b.locale.replace(/_/g, "-").toLowerCase() !== locale) continue;
    if (["title", "heading", "caption"].some(key => {
      const context = own(b.props, key);
      return typeof context === "string" && (unsafe(context) || scopeSensitive(context));
    })) continue; // A list item cannot detach itself from its section's condition.
    const origin = { source: "public_block" as const, blockId: b.id };
    if (["paragraph", "callout", "image_text_split"].includes(b.type)) {
      add(own(b.props, "text"), { ...origin, path: "props.text" });
    } else if (b.type === "list") {
      const items = own(b.props, "items");
      if (Array.isArray(items)) for (let i = 0; i < Math.min(items.length, 30) && facts.length < MAX_FACTS; i++)
        add(items[i], { ...origin, path: `props.items[${i}]` });
    }
  }
  if (facts.length < MAX_FACTS) add(input.description, { source: "description", path: "description" });
  if (facts.length < MAX_FACTS && input.variantAttributes) {
    for (const name of Object.keys(input.variantAttributes).slice(0, 30)) {
      if (facts.length === MAX_FACTS) break;
      if (!name.trim() || name.length > 80 || privateAttribute(name) || unsafe(name)) continue;
      const value = own(input.variantAttributes, name);
      if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT || unsafe(value)) continue;
      const text = `${name}: ${value}`;
      if (text.length > MAX_TEXT || seen.has(duplicateKey(text))) continue;
      seen.add(duplicateKey(text));
      facts.push({ text, source: "variant_attribute", productId: input.productId, variantId: input.variantId,
        attributeName: name, path: `variantAttributes.${name}`, start: 0, end: value.length });
    }
  }
  return facts;
}

export function extractSafeTargetReasons(input: PublicTargetFactsInput): string[] {
  return extractSafeTargetFacts(input).map(fact => fact.text);
}
