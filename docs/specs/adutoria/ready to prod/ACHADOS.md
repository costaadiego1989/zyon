# Registro consolidado de achados

68 achados. P0 bloqueia por impacto crítico; P1 precisa ser resolvido no fluxo habilitado; P2 pode ter bloqueio explícito quando compromete gate financeiro/audit/teste. “BLOCKS PROD: NO” não remove bloqueios de outros achados.

| ID | Severidade | Módulo | Problema | Bloqueia | Evidência |
| --- | --- | --- | --- | --- | --- |
| [API-001](<api/ADR-api-catalog.md#api-001>) | P0 | catalog | Reserva e mídia permitem operar recursos de outra loja | YES | CONFIRMED_STATIC |
| [API-002](<api/ADR-api-catalog.md#api-002>) | P0 | catalog | Reserva concorrente pode ultrapassar estoque disponível | YES | CONFIRMED_STATIC; concorrência PostgreSQL UNVERIFIED |
| [API-003](<api/ADR-api-stories.md#api-003>) | P0 | stories | Atualização e arquivamento ignoram o tenant recebido | YES | CONFIRMED_STATIC |
| [API-004](<api/ADR-api-storefront.md#api-004>) | P0 | storefront | WebSocket aceita salas de conversa sem autenticação ou vínculo | YES | CONFIRMED_STATIC |
| [API-005](<api/ADR-api-storefront.md#api-005>) | P0 | storefront | Flag de legado expõe consultas e mutações administrativas sem autenticação | YES | CONFIRMED_STATIC; exposição condicionada à flag; INFRA VALIDATION REQUIRED |
| [API-006](<api/ADR-api-marketplace.md#api-006>) | P0 | marketplace | Chargeback administrativo não recebe nem valida a loja | YES | CONFIRMED_STATIC |
| [API-007](<api/ADR-api-returns.md#api-007>) | P0 | returns | Reembolso é declarado concluído sem devolver dinheiro | YES | REPRODUCED_LOCAL R06 |
| [API-008](<api/ADR-api-marketplace.md#api-008>) | P0 | marketplace | Job marca transferência como realizada sem provedor | YES | CONFIRMED_STATIC |
| [API-041](<api/ADR-api-support.md#api-041>) | P0 | support | Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação | YES | CONFIRMED_STATIC |
| [API-042](<api/ADR-api-checkout.md#api-042>) | P0 | checkout | E-mail conhecido é tratado como prova de identidade do comprador | YES | CONFIRMED_STATIC |
| [API-043](<api/ADR-api-checkout.md#api-043>) | P0 | checkout | Preço e frete iniciais podem vir do cliente sem revalidação de catálogo | YES | CONFIRMED_STATIC; cobrança externa não executada |
| [API-009](<api/ADR-api-auth.md#api-009>) | P1 | auth | Refresh reutiliza token expirado e revogação não é compartilhada | YES | REPRODUCED_LOCAL R01; multi-réplica UNVERIFIED |
| [API-010](<api/ADR-api-auth.md#api-010>) | P1 | auth | Recuperação de senha depende de memória local | YES | CONFIRMED_STATIC |
| [API-011](<api/ADR-api-team.md#api-011>) | P1 | team | Papéis e remoção de membro não chegam ao principal de autenticação | YES | CONFIRMED_STATIC |
| [API-012](<api/ADR-api-payment.md#api-012>) | P1 | payment | Retry do POST Asaas não usa a chave idempotente derivada | YES | CONFIRMED_STATIC; comportamento externo UNVERIFIED |
| [API-013](<api/ADR-api-payment.md#api-013>) | P1 | payment | Intenção pendente sem ID do provedor não é retomada | YES | CONFIRMED_STATIC |
| [API-014](<api/ADR-api-payment.md#api-014>) | P1 | payment | Taxa do cartão diverge do total esperado na conclusão | YES | CONFIRMED_STATIC |
| [API-015](<api/ADR-api-payment.md#api-015>) | P1 | payment | Persistência não protege transições concorrentes do payment intent | YES | CONFIRMED_STATIC; race em banco UNVERIFIED |
| [API-016](<api/ADR-api-shared.md#api-016>) | P1 | shared | Claim do outbox não conserva exclusividade até o processamento | YES | CONFIRMED_STATIC |
| [API-017](<api/ADR-api-inventory.md#api-017>) | P1 | inventory | Handler de venda injeta token incorreto e absorve falhas | YES | CONFIRMED_STATIC |
| [API-018](<api/ADR-api-integrations.md#api-018>) | P1 | integrations | Envio de webhook passa Agent incompatível ao fetch | YES | REPRODUCED_LOCAL R02; serviço completo estático |
| [API-019](<api/ADR-api-cart-recovery.md#api-019>) | P1 | cart-recovery | Deduplicação das tentativas de recuperação é volátil | YES | CONFIRMED_STATIC |
| [API-020](<api/ADR-api-intent-memory.md#api-020>) | P1 | intent-memory | Consentimento e memória de intenção usam repositórios em memória | YES | CONFIRMED_STATIC |
| [API-021](<api/ADR-api-coupons.md#api-021>) | P1 | coupons | Limites de uso podem ser excedidos em sessões concorrentes | YES | CONFIRMED_STATIC |
| [API-022](<api/ADR-api-operations.md#api-022>) | P1 | operations | Cancelamento local pode encerrar antes do cancelamento externo | YES | CONFIRMED_STATIC |
| [API-023](<api/ADR-api-shipping.md#api-023>) | P1 | shipping | Compra de etiqueta precede validação do pedido | YES | CONFIRMED_STATIC |
| [API-024](<api/ADR-api-notifications.md#api-024>) | P1 | notifications | Adaptadores retornam sucesso sem entrega confirmada | YES | CONFIRMED_STATIC |
| [API-025](<api/ADR-api-buyer-account.md#api-025>) | P1 | buyer-account | Fallback SMS registra OTP e simula envio | YES | CONFIRMED_STATIC |
| [API-026](<api/ADR-api-whatsapp-channel.md#api-026>) | P1 | whatsapp-channel | Webhook confirma recebimento antes de persistir processamento | YES | CONFIRMED_STATIC; configuração ativa sem segredo INFRA VALIDATION REQUIRED |
| [API-027](<api/ADR-api-shared.md#api-027>) | P1 | shared | Rate limiter global pode liberar todas as requisições | YES | CONFIRMED_STATIC |
| [API-036](<api/ADR-api-public-api.md#api-036>) | P1 | public-api | Maioria dos controllers públicos não entra no AppModule | YES | CONFIRMED_STATIC |
| [API-038](<api/ADR-api-shared.md#api-038>) | P1 | shared | Gate de release não cobre o widget atual e falha localmente | YES | EXECUTED_FAILED + CONFIRMED_STATIC |
| [API-039](<api/ADR-api-shared.md#api-039>) | P1 | shared | Auditoria de dependências retornou avisos de segurança pendentes | YES | EXECUTED; exploitability UNVERIFIED |
| [API-044](<api/ADR-api-embed.md#api-044>) | P1 | embed | Emissão via storefront transforma parâmetros públicos em credencial de tenant | YES | CONFIRMED_STATIC |
| [API-045](<api/ADR-api-shared.md#api-045>) | P1 | shared | Compose de produção referencia Dockerfile ausente do storefront | YES | CONFIRMED_STATIC; deploy não executado |
| [DASH-001](<dashboard/ADR-dashboard.md#dash-001>) | P1 | dashboard | Onboarding usa etapas incompatíveis e impede compilação | YES | EXECUTED_FAILED + CONFIRMED_STATIC |
| [DASH-002](<dashboard/ADR-dashboard.md#dash-002>) | P1 | dashboard | Configurações de conta chamam endpoints ausentes | YES | CONFIRMED_STATIC |
| [DASH-003](<dashboard/ADR-dashboard.md#dash-003>) | P1 | dashboard | Ações de devolução usam nomes de rotas divergentes | YES | CONFIRMED_STATIC |
| [DASH-004](<dashboard/ADR-dashboard.md#dash-004>) | P1 | dashboard | Envio/entrega de marketplace apontam para rotas não declaradas | YES | CONFIRMED_STATIC |
| [SF-001](<storefront/ADR-storefront.md#sf-001>) | P1 | storefront | Paginação do catálogo público usa endpoint administrativo | YES | CONFIRMED_STATIC |
| [SF-002](<storefront/ADR-storefront.md#sf-002>) | P1 | storefront | Carrinho mistura alterações locais e chamadas incompletas | YES | CONFIRMED_STATIC |
| [SF-003](<storefront/ADR-storefront.md#sf-003>) | P1 | storefront | Heurísticas de centavos alteram preços legítimos | YES | CONFIRMED_STATIC |
| [SF-004](<storefront/ADR-storefront.md#sf-004>) | P1 | storefront | Busca marketplace envia query e interpreta envelope errados | YES | CONFIRMED_STATIC |
| [SF-005](<storefront/ADR-storefront.md#sf-005>) | P1 | storefront | Devolução do comprador chama controller não montado | YES | CONFIRMED_STATIC |
| [SF-006](<storefront/ADR-storefront.md#sf-006>) | P1 | storefront | Proxy /api/v1 troca credenciais de buyer/embed por chave de serviço | YES | CONFIRMED_STATIC; uso efetivo do proxy UNVERIFIED |
| [W2-001](<widget_v2/ADR-widget_v2.md#w2-001>) | P1 | widget_v2 | Início não hidrata carrinho e identidade usados pelo pagamento | YES | CONFIRMED_STATIC |
| [W2-002](<widget_v2/ADR-widget_v2.md#w2-002>) | P1 | widget_v2 | Resposta de intenção é lida com nomes que a API não retorna | YES | REPRODUCED_LOCAL R03 |
| [W2-003](<widget_v2/ADR-widget_v2.md#w2-003>) | P1 | widget_v2 | Polling omite session_id e ignora approved | YES | REPRODUCED_LOCAL R04 + CONFIRMED_STATIC |
| [W2-004](<widget_v2/ADR-widget_v2.md#w2-004>) | P1 | widget_v2 | Frete usa envelope/campos divergentes e fallback com preços inventados | YES | REPRODUCED_LOCAL R05 + CONFIRMED_STATIC |
| [W2-005](<widget_v2/ADR-widget_v2.md#w2-005>) | P1 | widget_v2 | Cartão não tem renderer ativo e confirmação usa body incorreto | YES | CONFIRMED_STATIC |
| [W2-006](<widget_v2/ADR-widget_v2.md#w2-006>) | P1 | widget_v2 | Cripto é oferecida sem fluxo de pagamento e confirmação | YES | CONFIRMED_STATIC |
| [W2-007](<widget_v2/ADR-widget_v2.md#w2-007>) | P1 | widget_v2 | Alteração de carrinho não invalida sessão/intent do checkout | YES | CONFIRMED_STATIC |
| [API-028](<api/ADR-api-audit.md#api-028>) | P2 | audit | Trilha de auditoria é gravada fora do commit da mutação | YES | CONFIRMED_STATIC |
| [API-029](<api/ADR-api-fulfillment.md#api-029>) | P2 | fulfillment | Tracking e evento não são atômicos | NO | CONFIRMED_STATIC |
| [API-030](<api/ADR-api-onboarding.md#api-030>) | P2 | onboarding | Transição salva antes do evento pode suprimir retry | NO | CONFIRMED_STATIC |
| [API-031](<api/ADR-api-store-settings.md#api-031>) | P2 | store-settings | Unicidade do slug depende de consulta sem constraint | NO | CONFIRMED_STATIC; migrações aplicadas UNVERIFIED |
| [API-032](<api/ADR-api-buyer-purchase-history.md#api-032>) | P2 | buyer-purchase-history | Histórico cresce sem limite nas leituras e saves | NO | CONFIRMED_STATIC; REQUIRES LOAD VALIDATION |
| [API-033](<api/ADR-api-revenue-manager.md#api-033>) | P2 | revenue-manager | Observação usa estimativas fixas como métricas | NO | CONFIRMED_STATIC |
| [API-034](<api/ADR-api-revenue-lift.md#api-034>) | P2 | revenue-lift | Atribuição monetária usa unidade divergente e só é logada neste fluxo | NO | CONFIRMED_STATIC |
| [API-035](<api/ADR-api-cross-sell.md#api-035>) | P2 | cross-sell | Módulo não montado usa catálogo sintético no aceite | YES | CONFIRMED_STATIC |
| [API-037](<api/ADR-api-shared.md#api-037>) | P2 | shared | Shutdown e backpressure do outbox não aguardam trabalho em curso | NO | CONFIRMED_STATIC; REQUIRES LOAD VALIDATION |
| [API-040](<api/ADR-api-marketplace.md#api-040>) | P2 | marketplace | Fila de catálogo perde identidade e ordenação de evento | NO | CONFIRMED_STATIC; ordering/TLS runtime UNVERIFIED |
| [DASH-005](<dashboard/ADR-dashboard.md#dash-005>) | P2 | dashboard | Salvar configurações busca ETag novo e pode sobrescrever edição concorrente | NO | CONFIRMED_STATIC |
| [DASH-006](<dashboard/ADR-dashboard.md#dash-006>) | P2 | dashboard | Suíte atual contém 33 falhas e cobertura de contrato insuficiente | YES | EXECUTED_FAILED |
| [SF-007](<storefront/ADR-storefront.md#sf-007>) | P2 | storefront | Adapter de orçamento descarta dados e abre conversa | NO | CONFIRMED_STATIC |
| [W2-008](<widget_v2/ADR-widget_v2.md#w2-008>) | P2 | widget_v2 | Tracking envia campos diferentes do contrato e não captura rejeição assíncrona | NO | CONFIRMED_STATIC |
| [W2-009](<widget_v2/ADR-widget_v2.md#w2-009>) | P2 | widget_v2 | Suporte responde políticas fixas em vez das configurações da loja | NO | CONFIRMED_STATIC |
| [W2-010](<widget_v2/ADR-widget_v2.md#w2-010>) | P2 | widget_v2 | Desconto é anunciado sem autorização persistida | YES | CONFIRMED_STATIC |

Critérios de aceite, complexidade e risco de mudança constam no ADR vinculado. [Formato estruturado](evidence/findings.json) preserva o mesmo conteúdo para backlog.
