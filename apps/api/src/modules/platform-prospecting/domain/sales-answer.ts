import type {ProspectOffer} from "@zyon/shared-types";
export const SALES_QUALIFICATION="Qual recurso da Zyon você gostaria de conhecer melhor?";
export function formatSalesOffer(offer:ProspectOffer){
  const price=new Intl.NumberFormat("pt-BR",{style:"currency",currency:offer.price.currency}).format(offer.price.amountCents/100);
  return `${offer.name}: ${price} por ${offer.billingCycle==="annual"?"ano":"mês"}.`;
}
export function formatSalesCatalog(offers:ProspectOffer[]){return offers.map(formatSalesOffer).join("\n");}
