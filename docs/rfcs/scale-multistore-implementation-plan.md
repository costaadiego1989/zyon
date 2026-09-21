# Plano de implementação — multiloja Scale e limites de voz

## Objetivo

Permitir que uma conta no plano Scale opere até cinco lojas isoladas, mantenha uma única assinatura e compartilhe a franquia mensal de 300 sessões de checkout por voz. O plano Growth tem uma loja e 100 sessões por mês. A avaliação Free dura 14 dias; ao encerrar, a loja pública deixa de atender e o proprietário é encaminhado para a assinatura no dashboard.

## Decisões de domínio

- A `Merchant` raiz é a conta de cobrança. Lojas adicionais apontam para ela por `billingAccountMerchantId`.
- Cada loja continua sendo um tenant: catálogo, tema, nome do assistente, integrações, templates de e-mail, WhatsApp, ERP/CRM, domínio e credenciais pertencem exclusivamente à loja.
- Assinaturas, faturas e uso de voz são resolvidos pela conta de cobrança. Assim, cinco lojas não multiplicam a franquia do Scale.
- A unidade contabilizada é uma sessão cuja credencial de tempo real foi criada, pois é o ponto anterior ao custo do provedor de IA.
- A taxa da loja no Free é zero durante a avaliação. A tarifa de R$0,99 cobrada do comprador é uma regra de checkout independente da assinatura do merchant.

## Fluxo da loja adicional

1. O proprietário seleciona uma loja no atalho do cabeçalho do dashboard.
2. A troca atualiza a loja ativa da sessão sem alterar as permissões do usuário.
3. No Scale, o proprietário cria uma nova loja até o total de cinco, incluindo a principal.
4. A nova loja recebe apenas identidade inicial (nome e slug). Nenhuma configuração ou segredo é copiado.
5. O usuário configura catálogo, marca, canais, templates e integrações da nova loja como uma operação independente.
6. Todos os acessos à API usam o merchant ativo e todas as operações de cobrança usam a conta raiz.

## Mudanças por camada

### Dados e migração

- Criar a relação de conta de cobrança entre merchants e índices para consultas de lojas gerenciadas.
- Criar período mensal de quota e reserva de sessão com chave idempotente.
- Fazer backfill: lojas existentes tornam-se sua própria conta de cobrança.
- Manter as migrações no diretório padrão do Prisma, para que o `prisma migrate deploy` de produção as aplique.
- Auditar a integridade após o backfill: nenhuma loja sem conta de cobrança e nenhuma loja adicional fora do limite de cinco.

### API e autorização

- Disponibilizar listar, criar e ativar lojas somente ao proprietário da conta Scale.
- Revalidar a associação usuário–merchant quando a loja ativa muda.
- Resolver assinatura, faturas e limites pelo merchant de cobrança em todos os endpoints públicos e administrativos.
- Aplicar guarda de acesso público: avaliação e assinatura ativa atendem; avaliação expirada devolve o código `store_subscription_required`.
- Preservar a resposta como contrato de API para que storefront e dashboard decidam o redirecionamento de forma consistente.

### Voz e custo de IA

- Reservar sessão em transação serializável antes de solicitar a credencial OpenAI.
- Usar contador condicional no período mensal para impedir estouro por concorrência.
- Reaproveitar a reserva para a mesma chave idempotente e loja de origem.
- Liberar a reserva quando a falha for conhecida antes de contatar o provedor; manter reserva pendente quando o resultado externo for indeterminado para evitar subcontagem.
- Exibir consumo, limite e renovação estimada no dashboard de assinatura.

### Interface e cobrança

- Publicar a matriz de planos: Free com avaliação de 14 dias, Growth R$449/mês e 100 sessões de voz, Scale R$749/mês e 300 sessões de voz compartilhadas.
- Oferecer anual pago antecipadamente com 15% de desconto: Growth R$4.579,80 e Scale R$7.639,80.
- Remover promessas antigas de sessões, conversas e conexões ilimitadas ou inexistentes.
- Desabilitar seleção do Free depois da avaliação e manter o CTA de assinatura.
- Redirecionar o storefront para o site principal quando a API sinalizar assinatura necessária; encaminhar o proprietário autenticado do dashboard para Assinatura.

### Stripe e ambientes

- Manter quatro prices ativos e coerentes: mensal/anual de Growth e mensal/anual de Scale.
- Conferir moeda, cobrança recorrente e valores em centavos antes de publicar.
- Manter os IDs exclusivamente nas variáveis de ambiente; nunca no frontend.
- Validar em produção que as variáveis, catálogo da API e cards do dashboard representam os mesmos valores.

## Estratégia de testes e rollout

1. Testes unitários para reserva, idempotência, concorrência lógica e liberação de quota.
2. Testes unitários para criação de loja, limite de cinco e isolamento da configuração inicial.
3. Testes de acesso público para avaliação ativa, expirada e assinatura ativa.
4. Typecheck, build de API, dashboard, storefront, widget e landing.
5. Aplicar migrações em ambiente controlado e verificar a inicialização do módulo de quota.
6. Publicar API antes dos consumidores web e validar `/ready`.
7. Publicar widget, dashboard, storefront e landing; confirmar aliases de produção e respostas HTTP.
8. Em uma conta de teste, executar a jornada autenticada: criar/trocar lojas, assinar, abrir checkout por voz até o limite e validar o bloqueio. Esta etapa exige credenciais de teste e pode consumir uso do provedor.

## Operação contínua

- Criar alerta interno quando o uso atingir 80%, 95% e 100% da franquia.
- Disponibilizar reconciliação de reservas pendentes após falha externa.
- Acompanhar tentativas bloqueadas, falhas de criação de credencial e custo por sessão por conta de cobrança.
- Registrar auditoria de criação e troca de loja, sem registrar tokens, mensagens ou credenciais de integração.
