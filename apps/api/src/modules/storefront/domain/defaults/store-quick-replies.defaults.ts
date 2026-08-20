import type { StoreQuickRepliesConfig } from "@zyon/shared-types";

export const DEFAULT_STORE_QUICK_REPLIES: StoreQuickRepliesConfig = {
  stages: [
    { stage: "welcome", label: "Início", replies: ["Ver Produtos", "Categorias", "Ofertas", "Calcular Frete", "Rastrear Pedido", "Meus Dados"] },
    { stage: "browsing", label: "Navegação", replies: ["Ver mais produtos", "Filtrar por preço", "Ordenar por desconto", "Ver categorias"] },
    { stage: "filter", label: "Filtros", replies: ["Mais baratos", "Mais vendidos", "Com frete grátis", "Limpar filtros"] },
    { stage: "categories", label: "Categorias", replies: ["Quero ver ofertas", "Buscar produto específico", "Voltar ao início"] },
    { stage: "product_detail", label: "Detalhe do Produto", replies: ["Adicionar ao carrinho", "Calcular frete", "Tem cupom?", "Produtos semelhantes"] },
    { stage: "more_info", label: "Informações", replies: ["Prazo de entrega", "Garantia", "Material e dimensões", "Voltar ao produto"] },
    { stage: "added_to_cart", label: "Adicionado ao Carrinho", replies: ["Finalizar Compra", "Continuar Comprando", "Aplicar Cupom", "Calcular Frete"] },
    { stage: "shipping", label: "Frete", replies: ["Finalizar Compra", "Continuar Comprando", "Aplicar Cupom"] },
    { stage: "post_purchase", label: "Pós-compra", replies: ["Rastrear Pedido", "Nota Fiscal", "Trocar ou devolver", "Suporte"] },
    { stage: "support", label: "Suporte", replies: ["FAQ", "Falar com humano", "Status do pedido", "Trocas e devoluções"] },
  ],
  fallback: ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"],
};
