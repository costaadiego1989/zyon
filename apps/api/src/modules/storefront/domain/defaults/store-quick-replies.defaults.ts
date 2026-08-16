import type { StoreQuickRepliesConfig } from "@zyon/shared-types";

export const DEFAULT_STORE_QUICK_REPLIES: StoreQuickRepliesConfig = {
  stages: [
    { stage: "welcome", label: "Início", replies: ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devoluções", "Rastrear Pedido", "Meus Dados", "Ofertas"] },
    { stage: "browsing", label: "Navegação", replies: ["Selecionar Produto", "Filtrar Produtos", "Categorias", "Ofertas do Dia", "Voltar ao Início"] },
    { stage: "filter", label: "Filtros", replies: ["Por Preço", "Por Avaliação", "Mais Vendidos", "Novidades", "Frete Grátis", "Por Desconto", "Limpar Filtros"] },
    { stage: "categories", label: "Categorias", replies: ["Ver Todas", "Filtrar Categoria", "Voltar"] },
    { stage: "product_detail", label: "Detalhe do Produto", replies: ["Adicionar ao Carrinho", "Mais Informações", "Ver Avaliações", "Tirar Dúvidas", "Comparar", "Lista de Desejos", "Produtos Semelhantes", "Voltar"] },
    { stage: "more_info", label: "Informações", replies: ["Especificações Técnicas", "Dimensões e Peso", "Material", "Garantia", "Prazo de Entrega", "Voltar ao Produto"] },
    { stage: "reviews", label: "Avaliações", replies: ["Escrever Avaliação", "Positivas", "Negativas", "Ordenar por Recentes", "Voltar ao Produto"] },
    { stage: "review_card", label: "Avaliação Selecionada", replies: ["Curtir", "Responder", "Reportar", "Voltar às Avaliações"] },
    { stage: "questions", label: "Dúvidas", replies: ["Fazer Pergunta", "Ver Respondidas", "Minhas Perguntas", "Voltar ao Produto"] },
    { stage: "compare", label: "Comparação", replies: ["Ver Tabela Comparativa", "Escolher Outro", "Adicionar ao Carrinho", "Voltar ao Produto"] },
    { stage: "wishlist", label: "Lista de Desejos", replies: ["Ver Lista", "Compartilhar", "Mover para Carrinho", "Remover Item", "Voltar"] },
    { stage: "added_to_cart", label: "Adicionado ao Carrinho", replies: ["Ver Carrinho", "Continuar Comprando", "Produtos Similares", "Aplicar Cupom", "Finalizar Compra"] },
    { stage: "post_purchase", label: "Pós-compra", replies: ["Rastrear Pedido", "Nota Fiscal", "Alterar Endereço", "Cancelar Pedido", "Avaliar Produto", "Suporte"] },
    { stage: "support", label: "Suporte", replies: ["FAQ", "Falar com Humano", "Reportar Problema", "Status do Pedido", "Voltar ao Início"] },
  ],
  fallback: ["Ver Produtos", "Categorias", "Meus Dados", "Suporte"],
};
