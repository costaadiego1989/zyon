# ADR — Widget v2 / chat

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-004](<../ADR-widget_v2.md#w2-004>) — Frete usa envelope/campos divergentes e fallback com preços inventados: Frete não é persistido e pagamento pode falhar shipping_method_required_before_payment; preço/prazo exibidos não são cotação aprovada.
- [W2-005](<../ADR-widget_v2.md#w2-005>) — Cartão não tem renderer ativo e confirmação usa body incorreto: Comprador escolhe cartão e não recebe formulário útil; confirmação corrigida parcialmente ainda falha 400.
- [W2-009](<../ADR-widget_v2.md#w2-009>) — Suporte responde políticas fixas em vez das configurações da loja: Promessas ao comprador podem contrariar configurações reais. Endurecer o backend sem atualizar socket rompe atendimento.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/widget_v2/src/store/checkout-store.ts:221](<../../../../../../apps/widget_v2/src/store/checkout-store.ts#L221>) | GET | {apiBaseUrl}/checkout-settings/widget-config?merchantId={encodeURIComponent(merchantId)} | Alcançável: checkout-settings /checkout-settings/widget-config | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-004: Cotação real deve renderizar e selecionar preço exato na sessão; provider indisponível não oferece frete fictício nem libera pagamento.
- W2-005: Teste em navegador percorre cartão/3DS até pedido; webhook atrasado e falha de rede não causam cobrança duplicada nem sucesso falso.
- W2-009: Alterar FAQ no dashboard muda conteúdo exibido; falha na API não inventa política; buyer recebe somente o seu ticket.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
