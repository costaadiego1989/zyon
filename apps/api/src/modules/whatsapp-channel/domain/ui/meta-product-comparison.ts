import { publicProductSummary } from "../../../storefront/domain/services/public-product-summary.js";

const characters = (text: string) => Array.from(text);
const clean = (text: unknown) => String(text ?? "").replace(/[\r\n|`]/g, " ").replace(/\s+/g, " ").trim();
const clipped = (text: string, width: number) => characters(text).length > width ? characters(text).slice(0, width - 1).join("") + "…" : text;
const padded = (text: string, width: number) => text + " ".repeat(Math.max(0, width - characters(text).length));
const row = (label: string, values: string[]) => [padded(clipped(label, 10), 10), ...values.map(value => padded(clipped(value, 9), 9))].join(" | ");
const labels: Record<string, string> = { brand: "Marca", marca: "Marca", color: "Cor", cor: "Cor", connectivity: "Conexão", conectividade: "Conexão", material: "Material", size: "Tamanho", tamanho: "Tamanho", volume: "Volume", voltage: "Voltagem" };

/** Narrow, transposed tables stay readable on a phone. Full names and exact
 * prices are retained outside the short cells, including very large prices. */
export function metaProductComparison(products: Record<string, any>[]): string[] {
  const results: string[] = [];
  for (let offset = 0; offset < Math.min(products.length, 5); offset += 2) {
    const pair = products.slice(offset, offset + 2);
    const aliases = pair.map((_product, index) => String.fromCharCode(65 + offset + index));
    const prices = pair.map(product => Number.isSafeInteger(product.price) && product.price >= 0
      ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price / 100).replace(/\s/g, " ") : "Não informado");
    const keys = [...new Set(pair.flatMap(product => Object.keys(product.attributes ?? {})))].slice(0, 3);
    const table = [row("Critério", aliases), row("Preço", prices.map(price => characters(price).length > 9 ? "Legenda" : price)),
      row("Estoque", pair.map(product => product.inStock === true ? "Dispon." : product.inStock === false ? "Indisp." : "Não inf.")),
      row("Nota / 5", pair.map(product => typeof product.rating === "number" && product.rating > 0 ? product.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "Sem av.")),
      ...keys.map(key => row(labels[key.toLowerCase()] ?? clean(key), pair.map(product => clean(product.attributes?.[key]) || "Não inf.")))];
    const details = pair.map((product, index) => `📦 *${aliases[index]} — ${clean(product.name)}*\n💰 *${prices[index]}*\n📄 ${publicProductSummary(product.description)}${keys.length ? "\n" + keys.flatMap(key => product.attributes?.[key] ? [`${labels[key.toLowerCase()] ?? clean(key)}: ${clipped(clean(product.attributes[key]), 120)}`] : []).join("\n") : ""}`);
    results.push(`🤖 📊 *Comparação de produtos*\n\n${details.join("\n\n")}\n\n\`\`\`\n${table.join("\n")}\n\`\`\`\n_Valores não informados não foram presumidos. Os campos com … estão resumidos acima._`);
  }
  return results;
}
