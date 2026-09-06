# Matriz de prontidão

**Veredito arquitetural: F — CRITICAL. Não assinaria a entrada desta versão em produção com as capacidades atuais habilitadas.** Há P0 concretos; o volume de arquivos/testes e controles já implementados não neutraliza esses caminhos.

| Dimensão | Status | Motivo / saída exigida |
| --- | --- | --- |
| Arquitetura modular | FAIL | Fronteiras de estado e comunicação frágeis; preservar monólito e corrigir ownership/ports. |
| Autenticação | FAIL | Refresh/revogação distribuída e reconhecimento indevido de buyer. |
| Autorização / multi-tenant | FAIL | Catálogo, stories, chargeback, sockets e emissor embed. |
| Dinheiro / pagamentos | FAIL | Refund/payout fictícios, total com taxa divergente, pending não recuperado. |
| Estoque / concorrência | FAIL | Reserva sobre valor antigo e handler de venda sem dependência correta. |
| Transações / idempotência | FAIL | CAS/outbox/efeito externo incompletos; teste com DB ainda necessário. |
| Mensageria / retries | FAIL | Claim sem lease, consumers absorvem falha, confirmação antes de inbox. |
| Contratos / dashboard | FAIL | Compile e endpoints ausentes/divergentes. |
| Contratos / storefront | FAIL | BFF/tenant, catálogo, preço, carrinho e devolução. |
| Contratos / widget_v2 | FAIL | Bootstrap, formatos, estados, frete e renderização de pagamento. |
| Schema / migração ativa | CONDITIONAL | Baseline contempla modelos estaticamente; migrate/upgrade não executados. |
| Build / testes | FAIL | API/dashboard types falham; testes com falhas; builds/E2E sem prova. |
| Dependências | CONDITIONAL / gate aberto | Audit com 35 high reportados; triagem de uso/correção necessária. |
| Observabilidade / audit | CONDITIONAL / audit FAIL | Infra existe; operação/alertas não demonstrados e trilha de mutação é best-effort. |
| Health / startup | CONDITIONAL | DB/Redis checks existem; DI, schema e workers não foram validados por boot completo. |
| Performance / pool / 10.000 usuários | REQUIRES LOAD VALIDATION | Sem EXPLAIN/profile/carga; não estimar capacidade com base apenas no código. |
| Backup / restore / secrets / DNS / rollout | INFRA VALIDATION REQUIRED | Sem execução/prova de ambiente; não declarar produção segura. |

Escala do roteiro: A produção comprovada; B pronta com dívida menor; C condicionada; D não pronta; F bloqueadores críticos. Não foi atribuído PASS de produção a nenhum app. Módulos CONDITIONAL não têm um P0/P1 próprio confirmado na amostra, mas herdam gates de infraestrutura e dependências. [Notas por módulo](api/README.md).
