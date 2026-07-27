# LGPD & Data Compliance Framework

## Overview

A AACP é um SaaS de checkout enterprise que processa dados pessoais sensíveis de compradores brasileiros. Como operador (controlador/operador sob LGPD) precisamos compliance com:

- **LGPD** (Lei 13.709/2018) — proteção de dados pessoais
- **PCI DSS** — dados de pagamento (mitigado via tokenização Stripe/Asaas)
- **Marco Civil da Internet** — logs de acesso
- **ANPD** — Autoridade Nacional de Proteção de Dados

## Dados Tratados

| Categoria | Dados | Sensibilidade | Base Legal |
|---|---|---|---|
| Buyer PII | nome, email, CPF, telefone, endereço | Alta | Execução contratual |
| Payment | tokens PIX, client_secret Stripe (nunca CVV/PAN) | Crítica | Execução contratual |
| Merchant credentials | API keys, webhook secrets | Crítica | Execução contratual |
| Purchase history | pedidos, valores, produtos, tracking | Média | Execução contratual |
| Chat conversations | mensagens buyer↔agente IA | Média | Legítimo interesse |
| Cross-merchant identity | global_user_id vinculando compras | Alta | Consentimento |
| Behavioral | abandonment score, events, sessions | Baixa | Legítimo interesse |
| Marketing | opt-in email/SMS/WhatsApp | Média | Consentimento |

## Análise do Estado Atual

### ✅ Implementado

| Controle | Implementação | Referência |
|---|---|---|
| Direito à exclusão (Art. 18 VI) | `DELETE /buyer/me/account` + anonymization | `delete-buyer-account.use-case.ts` |
| Portabilidade (Art. 18 V) | `GET /buyer/me/export` JSON completo | `export-buyer-data.use-case.ts` |
| Consentimento marketing | `POST /buyer/me/consent` com version tracking | `update-consent.use-case.ts` |
| Encryption at rest (secrets) | AES-256-GCM para merchant credentials | `payment-secret-cipher.ts` |
| Audit trail (merchant ops) | Interceptor global logando mutations | `audit-mutation.interceptor.ts` |
| Log redaction | Pino redact: auth, cookie, password, card, CVV | `app.module.ts` |
| Privacy/terms links | URLs configuráveis por merchant | Widget + dashboard |
| PCI mitigação | Tokenização via Stripe/Asaas (SAQ-A level) | Nunca armazena PAN/CVV |
| Webhook HMAC | Constant-time + timestamp freshness | `handle-asaas-webhook.use-case.ts` |
| Idempotency | Deduplica events, previne double-charge | Outbox + event markers |

### ⚠️ Parcial (precisa hardening)

| Controle | Gap | Prioridade |
|---|---|---|
| Encryption PII at rest | Email/CPF/phone/address não encriptados no DB | P1 |
| Data retention | Sem jobs de retenção/purge para sessions, audit, conversations | P1 |
| Consent UI no widget | Sem banner/modal de consentimento visível ao buyer | P1 |
| Audit buyer operations | Delete/export buyer não auditado pelo interceptor | P2 |
| Log redaction completo | Email, CPF, phone, address não redigidos | P2 |
| Cross-merchant consent | global_user_id vincula sem consentimento explícito | P2 |
| Consent version governance | `CURRENT_CONSENT_VERSION = "v1"` hardcoded | P3 |

### ❌ Ausente (precisa implementar)

| Controle | Descrição | Prioridade |
|---|---|---|
| ROPA (Registro Atividades) | Documento formal de todos processamentos | P1 |
| DPIA / RIPD | Impact assessment para cross-merchant identity + IA | P1 |
| Cookie consent banner | LGPD + ePrivacy compliance | P1 |
| Data retention policies | TTL por tipo de dado + cleanup jobs | P1 |
| DPO nomeação | Encarregado publicado no site | P1 |
| Breach notification plan | Plano de resposta + notificação ANPD (3 dias úteis) | P1 |
| Política de privacidade própria | Documento legal acessível | P1 |
| DPA com subprocessadores | Contratos com Stripe/Asaas/Vercel/etc | P2 |
| Data residency controls | Garantir dados em região BR ou documentar transferência | P2 |
| PII field-level encryption | Encriptar CPF, phone, address em repouso | P2 |
| Consent tracking per-merchant | Buyer autoriza cross-merchant antes de vincular | P2 |
| Automated retention jobs | Cron para expirar sessions, OTPs, conversations, audit | P2 |
| Privacy by design checklist | Review obrigatório por feature | P3 |
| Annual LGPD audit | Auditoria interna documentada | P3 |
| Staff training program | Treinamento LGPD para equipe | P3 |

## Requisitos Técnicos

### REQ-LGPD-001: Data Mapping (ROPA)

Documentar formalmente:
- Cada tipo de dado pessoal tratado
- Finalidade e base legal
- Período de retenção
- Compartilhamento com terceiros
- Medidas de segurança aplicadas

### REQ-LGPD-002: Consent Management

- Widget deve exibir modal de consentimento na primeira interação
- Buyer deve poder revogar consentimento a qualquer momento
- Cross-merchant identity linking requer consentimento explícito adicional
- Consent log imutável com timestamp + version + IP
- Marketing opt-in granular: email, SMS, WhatsApp, push

### REQ-LGPD-003: Data Retention Policies

| Dado | Retenção | Ação após expiração |
|---|---|---|
| Checkout sessions | 90 dias | Purge (hard delete) |
| Chat conversations | 1 ano | Anonymize (remover PII, manter métricas) |
| Payment intents | 5 anos (fiscal) | Manter (obrigação legal) |
| Purchase history | 5 anos (fiscal) | Manter |
| OTP codes | 10 minutos | Purge |
| Audit events (merchant) | 2 anos | Archive then purge |
| Buyer sessions/tokens | 24h | Purge |
| Rate limit records | 15 minutos | Auto-expire |
| Abandoned carts | 30 dias | Purge |
| WebAuthn challenges | 5 minutos | Purge |

### REQ-LGPD-004: Right to Deletion (existente, hardening)

- Expandir para incluir: checkout sessions, events, outbox records vinculados ao buyer
- Responder em até 15 dias (Art. 18 §5º)
- Log de exclusão no audit trail (sem dados pessoais)
- Notificar subprocessadores (Stripe/Asaas) se aplicável

### REQ-LGPD-005: PII Encryption at Rest

- Encriptar campos: CPF, phone, email, address em `BuyerAccount` e `CheckoutSession`
- Usar AES-256-GCM com key rotation support
- Derived key per-tenant ou per-field
- Searchable encryption para email (hash index) se necessário

### REQ-LGPD-006: Breach Notification

- Implementar `BreachIncidentService` com:
  - Detecção (anomaly em audit + rate limit + webhook failures)
  - Classificação de severidade
  - Template de notificação ANPD
  - Notificação buyer affected
  - Timeline: 3 dias úteis para ANPD, "prazo razoável" para titulares
  - Post-mortem obrigatório

### REQ-LGPD-007: Cookie Consent

- Banner no widget embed para cookies não-essenciais
- Categorias: essencial (session), analytics, marketing
- Persistir preferência no localStorage + API
- Respeitar "Do Not Track" header

### REQ-LGPD-008: Log Redaction (completo)

Adicionar aos paths pino redact:
- `*.email`
- `*.cpf`
- `*.phone`
- `*.address`
- `req.body.customer.*`
- `req.body.credit_card.*`
- `res.body.customer.cpf`

### REQ-LGPD-009: DPO & Governance

- Nomear encarregado (DPO)
- Publicar email de contato na página do produto
- Canal de atendimento ao titular (15 dias SLA)
- Processo de DPIA para features novas com dados pessoais

### REQ-LGPD-010: Subprocessor Management

| Subprocessador | Dados compartilhados | DPA necessário |
|---|---|---|
| Stripe | Card tokens, amounts, metadata | Sim (Stripe DPA padrão) |
| Asaas | CPF, nome, email, valores PIX | Sim |
| Vercel/Cloud (deploy) | Todos (se app hosted) | Sim |
| PostgreSQL provider | Todos (DB) | Sim |
| Brevo (email) | Email, nome | Sim |
| DeepSeek/OpenRouter (IA) | Conversas, contexto compra | Sim |
| Melhor Envio | CEP, endereço | Sim |

## Penalidades por não-conformidade

- Advertência
- Multa até **2% do faturamento** (cap R$ 50 milhões por infração)
- Publicização da infração
- Bloqueio/eliminação dos dados pessoais
- Suspensão das atividades de tratamento

## Plano de Implementação

### Sprint 1 — Foundations (P1)
1. Criar ROPA formal (documento)
2. Nomear DPO e publicar contato
3. Implementar data retention cron jobs
4. Adicionar cookie consent banner no widget
5. Expandir log redaction para PII
6. Criar política de privacidade
7. Documentar breach notification plan

### Sprint 2 — Hardening (P2)
1. PII field-level encryption (CPF, phone, address)
2. Cross-merchant consent explícito
3. Audit trail para buyer operations
4. DPAs com todos subprocessadores
5. Data residency documentation
6. Automated retention cleanup jobs

### Sprint 3 — Governance (P3)
1. DPIA para cross-merchant identity + IA
2. Privacy by design checklist
3. Consent version governance system
4. Annual audit process
5. Staff training program
6. SOC 2 Type II roadmap

## Referências

- [LGPD — Lei 13.709/2018](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD — Autoridade Nacional de Proteção de Dados](https://www.gov.br/anpd/pt-br)
- [ANPD Resolução CD/ANPD nº 15/2024 — Breach notification](https://www.gov.br/anpd/pt-br)
- [PCI DSS v4.0 — SAQ-A for tokenized merchants](https://www.pcisecuritystandards.org/)
- Artigos LGPD relevantes: 7, 11, 18, 33, 46, 48, 50
