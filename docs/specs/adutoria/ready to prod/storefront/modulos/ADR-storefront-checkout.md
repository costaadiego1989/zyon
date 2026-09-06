# ADR — Storefront / checkout

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-001](<../../widget_v2/ADR-widget_v2.md#w2-001>) — Início não hidrata carrinho e identidade usados pelo pagamento: Carrinho exibido pode ter itens enquanto sessão cobradora está vazia/incompleta; buyer informado no redirect não fica autenticado por esse parâmetro.
- [API-044](<../../api/ADR-api-embed.md#api-044>) — Emissão via storefront transforma parâmetros públicos em credencial de tenant: Qualquer caller da rota pode solicitar token com escopos de checkout/pagamento para tenant/origem escolhidos, ampliando o impacto dos defeitos de ownership e preço.
- [API-043](<../../api/ADR-api-checkout.md#api-043>) — Preço e frete iniciais podem vir do cliente sem revalidação de catálogo: Token embed com checkout:start pode inicializar itens, descontos ou frete adulterados e alimentar intenção com valor inferior ao catálogo quando não há commerceCartRef. Guard de tenant não garante autoridade de preço.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/components/conversation/checkout-redirect.ts:16](<../../../../../../apps/storefront/src/components/conversation/checkout-redirect.ts#L16>) | POST | /api/checkout-token | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-001: Redirect de carrinho real cria sessão com mesmos SKUs/valores; reload retoma a mesma compra; URL globalUserId não permite assumir identidade.
- API-044: Host de A não emite token de B, origem arbitrária é rejeitada e carrinho alheio não pode ser vinculado. Emissão anônima legítima permanece limitada ao contexto autorizado.
- API-043: Alterar price,total,currentDiscount,shipping e campos customer.*_verified no body não altera o valor autorizado nem o estado de autenticação; SKU desconhecido deve falhar.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
