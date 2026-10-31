import { hasCareProfile, normalizeSalesText, salesProductFamily, salesRecommendationContext } from "./sales-recommendation-intent.js";
import { isBroadShoppingRequest, salesDiscoveryHistory, type SalesDiscoveryQuestion } from "./sales-discovery.js";

type History = Array<{ role: "user" | "assistant"; content: string }>;
const profile: SalesDiscoveryQuestion = { question: "Como você descreveria sua pele?", replies: ["Oleosa", "Seca", "Mista", "Sensível"] };
const goal: SalesDiscoveryQuestion = { question: "Qual cuidado você quer priorizar para a pele?", replies: ["Hidratação", "Limpeza", "Proteção solar", "Não sei"] };

/** Bounded continuation of an already scoped need, never a catalog/write grant.
 * A new family or operational boundary uses the existing recommendation scope. */
export function contextualCareDiscovery(message: string, history: History) {
  const prior = salesDiscoveryHistory(history, message).slice(-10);
  const context = salesProductFamily(message) ? salesRecommendationContext(message, prior)
    : `${salesRecommendationContext("", prior)}. ${message}`;
  const skin = salesProductFamily(context) === "skin";
  const asked = (question: SalesDiscoveryQuestion) => prior.some(h => h.role === "assistant"
    && normalizeSalesText(h.content).includes(normalizeSalesText(question.question)));
  const question = skin && !hasCareProfile(context) ? [profile, goal].find(q => !asked(q)) : undefined;
  return { skin, profileReady: skin && hasCareProfile(context), question: question && structuredClone(question),
    profileWasAsked: asked(profile) };
}

/** Recovery only inside STORE_COMMERCE/COMPLEX_QUESTION without factual reads.
 * Positive request grammar and a known care need are both required. Refusal,
 * unrelated conversation and an attachment cannot open this fallback. */
export function explicitlyContinuesCareDiscovery(message: string, history: History): boolean {
  const text = normalizeSalesText(message).trim();
  if (/\b(?:nao|nunca|nem)\s+(?:quero|preciso|gostaria|desejo|me ajude|me oriente)\b/.test(text)) return false;
  const care = contextualCareDiscovery(message, history);
  if (!care.skin) return false;
  const guidance = /\b(?:quero|preciso|gostaria|pode|poderia|ajude|oriente|indique|recomende)\b/.test(text)
    && /\b(?:orient\p{L}*|escolh\p{L}*|indic\p{L}*|recomend\p{L}*)\b/u.test(text)
    && !/\b(?:talvez|depois|caso|pesquisando|comparando)\b|\bvou pensar\b/.test(text);
  const unknownAnswer = care.profileWasAsked && /^nao (?:sei|consigo)(?: (?:dizer|identificar))?[.!?]*$/.test(text);
  return guidance || unknownAnswer || isBroadShoppingRequest(message);
}
