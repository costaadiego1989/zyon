# Plano de correção posterior

Este documento organiza trabalho futuro. Nenhum item foi implementado nesta auditoria. Manter patches pequenos, teste de falha primeiro e revisão por domínio; não fazer refactor amplo junto de mudança financeira. A ordem prioriza **API antes dos fronts**.

| Onda | Responsável funcional proposto | Trabalho | Saída verificável |
| --- | --- | --- | --- |
| 0 — baseline de trabalho | Plataforma / mantenedores | Preservar mudanças atuais, registrar commit candidato, corrigir geração/tipos/CI e receita de deploy (API-038/045); preparar PostgreSQL/Redis isolados. | Build reproduzível, matriz dos quatro apps e ambiente de teste sem dependência de produção. |
| 1 — segurança API | Auth, checkout, catalog, stories, marketplace, support, embed | API-001/003/004/005/006/009/010/011/025/026/027/041/042/043/044. Fechar tenant, sockets, buyer proof e emissor de token. | Testes A/B merchant e buyer, campos monetários não confiáveis rejeitados e revogação distribuída. |
| 2 — verdade financeira e estoque | Payment, returns, marketplace, catalog/inventory | API-002/007/008/012/013/014/015/017/021/022/023. Valores autoritativos, CAS, intenção externa e conciliação. | Uma cobrança/baixa/restituição por operação, crash/retry converge e ledger bate com provider. |
| 3 — durabilidade e canais | Plataforma, integrations, notifications | API-016/018/019/020/024/028/029/030/037/040; outbox/inbox, persistência de consentimento, timeout/dead-letter. | Workers múltiplos, restart, Redis/DB/provider indisponíveis e replay com efeito único. |
| 4 — contrato único da API | Mantenedores API e consumidores | API-031/035/036; eliminar colisão shipping/select, publicar DTOs/erros/envelopes e superfície montada. | OpenAPI/manifesto de AppModule e clients tipados concordam; APIs legadas não necessárias à compra. |
| 5 — dashboard | Equipe dashboard + donos da API | DASH-001 a DASH-006 e achados herdados por módulo. | Onboarding, conta, devolução, marketplace e concorrência settings passam E2E e suíte. |
| 6 — storefront | Equipe storefront + buyer/catalog | SF-001 a SF-007, emissão segura API-044 e sessão autoritativa. | Visitante real consulta produtos e compra por loja; atualização/reload e pós-venda consistentes. |
| 7 — widget_v2 | Equipe checkout frontend + payment/shipping | W2-001 a W2-010: bootstrap, DTOs, polling, frete, cartão, cripto, tracking, suporte e oferta autorizada. | Compra real em sandbox, sem dados inventados nem sucesso apenas local; testes de browser e contrato. |
| 8 — medição e release | Plataforma / operação / donos de produto | API-032/033/034/039, triagem dependências, dados de métricas, carga, migration, restore, alertas, rollout. | SLO definido/atendido e evidência da versão candidata; aceite explícito de dívida não bloqueante. |

Segurança financeira pode exigir desabilitar temporariamente capacidade incompleta, como refund/payout fictício, até existir implementação. Não habilitar módulo ausente ou ENABLE_LEGACY_ROUTES apenas para eliminar 404 sem corrigir seu controle.

## Definition of done por achado

1. Teste reproduz o cenário inseguro/inconsistente original com dados isolados.
2. Patch corrige causa e todos os aliases/caminhos relevantes; nenhuma regra fica somente no frontend.
3. Testes de negócio, contrato e erro/retry passam. Para dinheiro/estoque, incluir concorrência real.
4. Migração/rollback e compatibilidade de consumidor são revisados quando aplicáveis.
5. Logs/métricas mostram falha e recuperação sem expor segredo/PII.
6. Atualizar ADR com commit, evidência e risco residual; não marcar resolvido só por adicionar comentário/teste mock.

## Gate final

Zero P0 aberto; P1 resolvido para cada capacidade habilitada; P2 bloqueante resolvido; matriz de build/test/contrato verde. E2E de comprador/lojista, provider sandbox, entrega/outbox, falha de dependências, migração limpa e backup/restore comprovados. Capacidade não pronta permanece explicitamente indisponível, sem simular sucesso. Limite/custo/SLO de tráfego definidos antes de executar a carga.

Não há prazo ou responsável nominal inferido; os owners acima indicam capacidade de negócio a atribuir no planejamento.
