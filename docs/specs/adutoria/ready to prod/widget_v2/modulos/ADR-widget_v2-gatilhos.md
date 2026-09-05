# ADR — Widget v2 / gatilhos

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-widget_v2.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [W2-010](<../ADR-widget_v2.md#w2-010>) — Desconto é anunciado sem autorização persistida: Banner pode prometer 5% que não chega ao total do pagamento e pode ultrapassar regra da loja.
- [API-021](<../../api/ADR-api-coupons.md#api-021>) — Limites de uso podem ser excedidos em sessões concorrentes: Cupom de uso único pode ser consumido mais vezes e falhas intermediárias podem desalinhar contador/evento.

## Chamadas e provedor

Não foi extraído call site HTTP próprio. O componente pode delegar a outro client; conferir o ADR do app. Arquivo other.ts é shell obsoleto sem métodos e não deve ser tratado como capacidade implementada.

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- W2-010: Loja com desconto máximo zero nunca exibe oferta de 5%; oferta exibida deve ser reconciliada no pagamento.
- API-021: Com maxUses=1, duas sessões/buyers paralelos produzem um consumo; crash em cada fronteira não altera cota nem publica em duplicidade.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
