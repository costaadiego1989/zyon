# Planos e cobrança anual

Growth permanece em R$ 349/mês e Scale em R$ 599/mês. O anual é pago de uma vez, com desconto apenas sobre a assinatura. A API calcula em centavos e publica o mesmo catálogo para site, cadastro e painel.

| Plano | Total anual com 15% | Equivalente mensal | Economia anual | Compras confirmadas/mês | Tarifa da loja/compra |
| --- | --- | --- | --- | --- | --- |
| Free | Sem anuidade | R$ 0 | — | 100 | R$ 2,99 após o teste |
| Growth | R$ 3.559,80 | R$ 296,65 | R$ 628,20 | 500 | R$ 1,49 |
| Scale | R$ 6.109,80 | R$ 509,15 | R$ 1.078,20 | Sem limite mensal | R$ 0,99 |

O comprador paga R$ 0,99 de serviço por compra. Tarifas do provedor e implantação ficam separadas do desconto. O simulador do site soma assinatura e tarifas da loja; no anual, usa o equivalente mensal e informa o pagamento único.

## Configuração e ativação

- BILLING_ANNUAL_ENABLED=false por padrão: ausência ou configuração inválida desabilita novas contratações anuais e mantém o mensal.
- BILLING_ANNUAL_DISCOUNT_PERCENT=15: inteiro entre 0 e 99. Alterar o desconto afeta novas contratações, sem recalcular contratos existentes.
- STRIPE_BILLING_PRICE_GROWTH_ANNUAL e STRIPE_BILLING_PRICE_SCALE_ANNUAL: preços recorrentes em BRL, intervalo year, quantidade 1 e valor exato do catálogo.
- Os respectivos sufixos _LEGACY preservam o reconhecimento de IDs antigos, separados por vírgula.
- CORS_ALLOWED_ORIGINS deve incluir as origens do site público que consultam GET /billing/catalog. O endpoint não publica identificadores de provedores ou informações de lojistas.

O seletor anual só permite contratação se a API habilitar a oferta e o ID correspondente estiver configurado. O checkout verifica o preço real no Stripe antes de abrir uma sessão. Uma divergência bloqueia a operação; nunca converte silenciosamente para mensal. Descontos promocionais adicionais estão desabilitados no checkout anual.

Aplicar a migração aditiva 20260914120000_annual_billing antes de publicar a API e gerar o Prisma Client no ambiente de build. Os registros existentes recebem ciclo mensal e desconto zero. Não há reajuste em lote.

Provisionar preços com apps/api/scripts/setup-stripe-billing.ts, que usa dry-run por padrão:

    node --experimental-strip-types scripts/setup-stripe-billing.ts --plan growth --cycle annual
    node --experimental-strip-types scripts/setup-stripe-billing.ts --plan scale --cycle annual

O comando deve ser executado em apps/api com shared-types compilado. --apply cria somente produtos/preços, sem alterar assinaturas. NODE_ENV seleciona a chave de produção ou teste. Conferir a conta, valores e modo antes de aplicar.

Antes de habilitar em produção: validar checkout, renovação, cancelamento, troca mensal/anual e webhook em conta de teste dos provedores; configurar os IDs; aplicar a migração e publicar a API; só então habilitar o flag e publicar site/dashboard. O flag pode voltar a false sem cancelar assinaturas existentes. A alteração do schema não deve ser revertida apagando dados contratuais.

## Ciclo de vida

A assinatura guarda ciclo, valor e desconto contratados. Mudanças de intervalo e alterações em assinaturas anuais ficam agendadas para a renovação, preservando o período pago. O painel mostra o valor e a vigência antes da confirmação. Uma segunda alteração pendente é rejeitada para não sobrepor o agendamento.

Stripe usa Subscription Schedules com duas fases, sem prorrateio imediato. A assinatura atual conserva seu preço na fase vigente; a próxima fase recebe o preço escolhido. Agendamentos externos não são sobrescritos. O webhook consulta o estado atual do Stripe para evitar que um evento atrasado restaure um contrato antigo.

Asaas usa YEARLY para o anual, com o valor integral. Alterações agendadas verificam cobranças pendentes e são recusadas quando há cobrança já gerada, para revisão operacional. O valor de cobranças existentes não é alterado nesse fluxo. A confirmação precisa corresponder ao valor salvo e a uma data de vencimento válida. Eventos repetidos do mesmo pagamento e pagamentos de períodos anteriores não estendem o acesso.

Mudanças entre planos mensais no fluxo legado do Asaas continuam dependendo do pagamento confirmado. O cancelamento Stripe permanece no portal. No Asaas, o cancelamento usa a API existente; não há prorrateio ou reembolso anual automático novo.

## Limites e custo de IA

A unidade comercial é compra com pagamento confirmado. A contagem reinicia por mês calendário UTC, inclusive em assinaturas anuais. Recarregamento, sessão e conversa não consomem a franquia comercial. As limitações de conexões, equipe e recursos de cada plano permanecem.

O Growth inclui domínio próprio, texto/voz, base de conhecimento e configuração de entregas. O Scale anuncia compras sem limite mensal; alto consumo, integrações especiais e atendimento diferenciado são negociados sob consulta.

Medição técnica de IA e proteções operacionais são separadas do limite comercial. A mudança não implementa uma nova contabilidade completa de custo de IA. Antes de criar uma franquia, medir tokens de entrada/saída, modelo, cache, áudio, infraestrutura e suporte por lojista. Uma conversa curta e uma longa têm custos diferentes. Não há cobrança automática de excedente de IA.

## Implantação assistida

Preço: R$ 749, serviço opcional. Escopo publicado: uma loja, um domínio, até 50 produtos em planilha padrão, uma integração nativa, orientação de até 60 minutos e uma rodada de ajustes. Desenvolvimento de integração, limpeza/migração especial de dados e atendimento contínuo exigem orçamento separado. Não existe cobrança automática desse serviço no checkout da assinatura.

Registrar custo de execução antes de aceitar cada serviço. Estimativa interna inicial: no máximo quatro horas de trabalho total. Esse teto é uma premissa de planejamento, não custo observado.

| Componente do custo | Como registrar |
| --- | --- |
| Trabalho | Horas estimadas × custo interno/hora |
| Ferramentas e terceiros | Custo incremental da implantação |
| Impostos e tarifa de recebimento | Valores aplicáveis ao serviço |
| Retrabalho | Reserva explícita |
| Margem estimada | 749 menos todos os custos acima |

Os custos reais ainda precisam ser preenchidos pela operação; não há margem comprovada somente pelo preço.

## Validação local

Testes da API cobrem valores e configuração inválida, calendário, pagamento duplicado, contrato salvo, troca de intervalo, integração dos adaptadores, domínio próprio e cotas mensais. Playwright cobre cadastro, indisponibilidade anual, revisão da troca e simulador, em desktop e celular, com provedores simulados.

    node --loader ./tests/ready-prod-loader.mjs --test --test-force-exit src/modules/payment/application/annual-billing.spec.ts
    pnpm exec playwright test --config playwright.billing.config.ts

O primeiro comando roda em apps/api e o segundo em apps/dashboard. Essas verificações não comprovam liquidação nem comportamento da conta real dos provedores.

Resultado local em 14/09/2026: 46 testes da API e 8 cenários Playwright aprovados; build do dashboard, typecheck da API, catálogo estático e prisma validate aprovados. A geração padrão do Prisma Client encontrou EPERM ao substituir uma DLL em uso no Windows; nenhum processo de desenvolvimento foi encerrado. A migração ainda não foi aplicada a banco de dados, e o build completo da API deve gerar o cliente em ambiente sem esse bloqueio.

Referências: [Stripe Subscription Schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules), [Asaas: atualizar assinatura](https://docs.asaas.com/reference/atualizar-assinatura-existente), [Asaas: cobranças da assinatura](https://docs.asaas.com/reference/listar-cobrancas-de-uma-assinatura), [precificação de IA por consumo](https://platform.claude.com/docs/en/about-claude/pricing).
