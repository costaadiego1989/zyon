# ADR — Dashboard / onboarding

Data: 2026-09-05. Status: auditoria registrada, correções propostas. Veredito: **FAIL**.

[Relatório do app](<../ADR-dashboard.md>) · [Matriz global](<../../CONTRATOS.md>)

## Contexto e decisão

Este módulo foi delimitado pelo arquivo de endpoints ou infraestrutura HTTP correspondente. A decisão é usar contrato autoritativo da API montada, com tenant, principal, estados e unidades explícitos. Suporte HTTP aparente não certifica uso correto de DTO ou implementação da tela.

- [DASH-001](<../ADR-dashboard.md#dash-001>) — Onboarding usa etapas incompatíveis e impede compilação: Build do dashboard bloqueado; contornar tipagem não torna as etapas válidas no backend.
- [API-030](<../../api/ADR-api-onboarding.md#api-030>) — Transição salva antes do evento pode suprimir retry: Conclusão pode aparecer no dashboard sem ativar consumidores dependentes.
- [API-044](<../../api/ADR-api-embed.md#api-044>) — Emissão via storefront transforma parâmetros públicos em credencial de tenant: Qualquer caller da rota pode solicitar token com escopos de checkout/pagamento para tenant/origem escolhidos, ampliando o impacto dos defeitos de ownership e preço.

## Chamadas e provedor

| Consumidor | Método | Path/expressão | Candidato na API | Limite da evidência |
| --- | --- | --- | --- | --- |
| [apps/dashboard/src/api/endpoints/onboarding.ts:11](<../../../../../../apps/dashboard/src/api/endpoints/onboarding.ts#L11>) | GET | /onboarding | Alcançável: onboarding /onboarding | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/onboarding.ts:14](<../../../../../../apps/dashboard/src/api/endpoints/onboarding.ts#L14>) | POST | /onboarding/steps/{encodeURIComponent(step)}/complete | Alcançável: onboarding /onboarding/steps/:step/complete | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |
| [apps/dashboard/src/api/endpoints/onboarding.ts:29](<../../../../../../apps/dashboard/src/api/endpoints/onboarding.ts#L29>) | POST | /embed/sessions | Alcançável: embed /embed/sessions | Apenas comparação de path/método; DTO/auth/runtime dependem da análise abaixo |

Expressões dinâmicas foram aproximadas por AST; nomes de variáveis não são URLs reais. Um candidato não prova que a função esteja alcançada pela UI. Rotas /v1 usam o mesmo middleware e a mesma política de legado.

## Critérios de correção e reavaliação

- DASH-001: tsc/build passam; percorrer STORE_ONLY/CHECKOUT_ONLY/BOTH e retomar onboarding em outra sessão conclui somente etapas reconhecidas.
- API-030: Injetar falha no outbox após save e repetir: um evento lógico precisa existir para cada mudança concluída.
- API-044: Host de A não emite token de B, origem arbitrária é rejeitada e carrinho alheio não pode ser vinculado. Emissão anônima legítima permanece limitada ao contexto autorizado.

## Consequências

Correções deste consumidor dependem do contrato e controles da API. A camada visual não deve contornar erro adicionando credencial privilegiada, inventando dados ou marcando efeito financeiro como concluído. Nenhuma implementação foi alterada nesta auditoria.
