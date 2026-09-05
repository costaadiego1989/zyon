# ADR — Storefront / comprador

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-storefront.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pela capacidade da jornada e seus clientes/componentes. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [SF-005](<../ADR-storefront.md#sf-005>) — Devolução do comprador chama controller não montado: Comprador não abre devolução válida; simplesmente montar o controller ainda exige corrigir identificação de item e principal buyer.
- [API-042](<../../api/ADR-api-checkout.md#api-042>) — E-mail conhecido é tratado como prova de identidade do comprador: Informar o email de um comprador existente pode vincular a identidade dele e expor dados de perfil numa sessão nova. Histórico de verificação não prova posse no request atual.
- [API-020](<../../api/ADR-api-intent-memory.md#api-020>) — Consentimento e memória de intenção usam repositórios em memória: Consentimento/revogação e registros divergem entre réplicas e desaparecem em restart. Não é possível comprovar política durável de uso/exclusão por buyer.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/storefront/src/components/BuyerHub.tsx:161](<../../../../../../apps/storefront/src/components/BuyerHub.tsx#L161>) | GET | {API_BASE}/buyer/me/profile | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerHub.tsx:162](<../../../../../../apps/storefront/src/components/BuyerHub.tsx#L162>) | GET | {API_BASE}/buyer/me/purchases?limit=10 | Alcançável: buyer-account /buyer/me/purchases | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerHub.tsx:197](<../../../../../../apps/storefront/src/components/BuyerHub.tsx#L197>) | POST | {API_BASE}/buyer/phone/send | Alcançável: buyer-account /buyer/phone/send | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerHub.tsx:222](<../../../../../../apps/storefront/src/components/BuyerHub.tsx#L222>) | POST | {API_BASE}/buyer/phone/verify | Alcançável: buyer-account /buyer/phone/verify | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerHub.tsx:854](<../../../../../../apps/storefront/src/components/BuyerHub.tsx#L854>) | GET | {API_BASE}/buyer/consent/intent-memory | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerLoginForm.tsx:36](<../../../../../../apps/storefront/src/components/BuyerLoginForm.tsx#L36>) | POST | {API_BASE}/buyer/phone/send | Alcançável: buyer-account /buyer/phone/send | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerLoginForm.tsx:48](<../../../../../../apps/storefront/src/components/BuyerLoginForm.tsx#L48>) | POST | {API_BASE}/buyer/phone/verify | Alcançável: buyer-account /buyer/phone/verify | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:14](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L14>) | POST | {API_BASE}/v1/storefront/conversations/{encodeURIComponent(sessionId)}/events | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:101](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L101>) | GET | https://viacep.com.br/ws/{digits}/json/ | Revisão manual / dinâmico / externo / ausente | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:128](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L128>) | POST | {API_BASE}/buyer/phone/send | Alcançável: buyer-account /buyer/phone/send | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:156](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L156>) | POST | {API_BASE}/buyer/phone/verify | Alcançável: buyer-account /buyer/phone/verify | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:178](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L178>) | POST | {API_BASE}/buyer/email/send | Alcançável: buyer-account /buyer/email/send | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:196](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L196>) | POST | {API_BASE}/buyer/email/verify | Alcançável: buyer-account /buyer/email/verify | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/BuyerRegistrationForm.tsx:236](<../../../../../../apps/storefront/src/components/BuyerRegistrationForm.tsx#L236>) | POST | {API_BASE}/buyer/register | Alcançável: buyer-account /buyer/register<br>Não montada: self-checkout /buyer/register | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/storefront/src/components/ReturnRequestForm.tsx:58](<../../../../../../apps/storefront/src/components/ReturnRequestForm.tsx#L58>) | POST | {API_BASE}/buyer/returns/request | Não montada: returns /buyer/returns/request | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- SF-005: Buyer autenticado seleciona item comprado e abre devolução; outro buyer não acessa pedido; token expirado e pedido inexistente são tratados.
- API-042: Sessão nova com email de vítima, sem OTP/buyer token, permanece não verificada e não recebe dados da conta. Cobrir início e captura por chat.
- API-020: Conceder em A, ler e revogar em B, reiniciar ambas: registro de intenção novo deve obedecer à revogação e exclusão deve ser verificável.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
