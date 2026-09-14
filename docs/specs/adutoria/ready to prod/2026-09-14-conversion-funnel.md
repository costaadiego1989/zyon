# Publicação do funil Zyon — 14/09/2026

**Publicação concluída e conferida às 13:36 BRT.**

- API: commit `43616925d705ea11271c114e93ea484c82832d31`, publicado em `origin/master`; Railway deployment `dd68f0b1-2e8c-4b2b-a87f-f24eb60533c9` com status **SUCCESS**. `https://api.zyon-payments.com.br/ready` retornou 200 e banco conectado depois da troca de versão; `/health` retornou 200.
- Dashboard: `dpl_3n3aVVKrQdarhXR4vcps5xwL4fWm`, **READY**, em https://app.zyon-payments.com.br. O bundle publicado contém as correções do funil. Cadastro e navegação para login verificados no Chromium, desktop e 390 px, sem erros de execução.
- Widget: `dpl_Ha2ef6PyuuVNWgiG2LYGC9iNtsX4`, **READY**, em https://widget.zyon-payments.com.br. Snapshot `d9985d7` preservado na branch `release/funnel-widget-20260914`. A comparação dos hashes dos fontes antes/depois na Vercel confirma que somente `src/lib/tracking.ts` mudou; a apresentação já publicada foi preservada. O bundle servido ignora a conclusão de pedido informada pelo navegador.

## Validação da versão publicada

- Build completo da API aprovado; dashboard e widget compilados localmente e nos provedores.
- **96/96** testes de regressão após integração com a base remota: funil, persistência, isolamento, pagamentos, callback, experimentos e outbox; nenhum ignorado.
- **6/6** cenários de navegador do funil com banco local, incluindo CSV, comparação, troca de loja, erros e celular.
- **11/11** cenários com a API Nest compilada e composição de produção sobre PostgreSQL/Redis descartáveis: autenticação local, isolamento, bloqueio de conversão forjada, callback assinado, deduplicação e rejeição de valor/moeda inválidos.
- Em produção, rotas de funil sem autenticação responderam 401. Foram verificados os bundles finais e a disponibilidade dos domínios.

## Escopo e limites

A publicação usou checkouts isolados. As atualizações remotas até `8d8fd77` foram preservadas, assim como os ajustes visuais do widget que estavam publicados fora do Git. A árvore principal e seu índice de alterações concorrentes foram preservados. Nenhuma nova migração ou mudança de configuração foi incorporada a esta publicação do funil; as sete cópias de migrações usadas na auditoria ampla local abaixo não foram publicadas por esta entrega.

A autenticação de um lojista e uma compra real com liquidação no gateway **não foram executadas em produção**. O callback assinado e a conversão persistida foram validados localmente. A publicação concluída não equivale a comprovar cobrança ou liquidação real.

Evidências: `apps/api/test-results/funnel-production/` e `apps/dashboard/test-results/funnel-production/`. O conteúdo abaixo registra a auditoria anterior à autorização de publicação, incluindo a suíte mais ampla de 122 testes e migrações locais.

---

# Zyon — validação do funil de conversão

Data: 14/09/2026. Projeto: `C:\Users\Admin\Desktop\AACP`. Base Git: `2681ab3`, com alterações concorrentes preservadas.

**Resultado: funil e processamento local de callbacks validados; aprovação de produção ainda condicionada às verificações externas abaixo.** O usuário confirmou que não existe ambiente de homologação. Nenhum deployment, cobrança real ou envio de mensagem a clientes foi realizado.

## Resultado consolidado

| Verificação | Resultado |
| --- | --- |
| Suíte consolidada da API: checkout, funil, acesso, experimentos, pagamentos, rastreio e outbox | **122/122 passaram**, sem ignorados |
| Banco real para segmentação, isolamento, concorrência e deduplicação do funil | **7/7 passaram**, incluídos na suíte acima |
| Dashboard no Chromium, incluindo largura de 390 px | **6/6 passaram**, sem erros de execução, na etapa anterior desta auditoria |
| API Nest compilada, composição real em `NODE_ENV=production`, PostgreSQL e Redis separados | **Passou**: `/health`, `/ready`, cadastro/login e sessão persistida |
| Funis via HTTP real | **Passaram**: autenticação, isolamento entre lojistas, datas e bloqueio de telemetria de conclusão |
| Callback Stripe assinado localmente → pagamento → pedido → conversão | **Passou**: pedido e evento únicos; repetição não duplica; assinatura inválida, recusa, valor e moeda divergentes não convertem |
| Script completo de build da API, com Prisma e Nest | **Passou**, código de saída 0, em cópia isolada com dependências próprias |
| Migrações pelo comando real de deploy seguro, desde banco vazio | **27/27 aplicadas** |
| Typechecks API, dashboard e widget; bundle de produção do dashboard | **Passaram** nesta auditoria; o build final da API também recompilou as novas correções |

Os resultados de runtime são duas execuções com cenários comuns: 9 verificações sem Stripe configurado e 11 com callbacks assinados de teste. Não são 20 cenários distintos. As evidências de navegador usam o componente e os casos de uso reais com PostgreSQL e um adaptador HTTP de teste; a validação posterior de runtime usa o Nest real, seus guards, middleware, repositórios e sessão de autenticação persistida.

## Correções no funil

- Telemetria pública do checkout rejeita `order_completed`; a da loja rejeita `order_completed` e `purchase_completed`. O widget deixou de enviar conclusão redundante, e o contrato público deixou de anunciá-la como evento de cliente. A conclusão interna continua exigindo aprovação persistida compatível com lojista, sessão, valor, moeda e carrinho.
- Segmentos usam as mesmas sessões com atividade no período do total do funil, incluindo sessões antigas retomadas, com separação entre loja, checkout e lojista. Sessões recentes do checkout também filtram a origem.
- Dispositivo e pagamento atribuem uma categoria por sessão pela última informação válida. `card` é normalizado para `credit_card`; ausência aparece como “Não informado”.
- Clique no campo de cupom não conta como cupom aplicado. Login fica separado do cadastro; toda sessão com atividade conta na entrada. Cupom e falha de pagamento ficam fora das transições lineares.
- Datas usam UTC explicitamente, preservam instantes ISO com fuso e rejeitam intervalos incompletos, invertidos ou inválidos.
- Criação de sessão de telemetria usa `upsert`; eventos renovam a última atividade. Concorrência entre primeiros eventos foi testada em PostgreSQL.
- Dashboard descarta respostas antigas após troca de origem, lojista ou filtro, exibe falhas e permite nova tentativa. CSV mantém percentuais corretos. Gráfico tem transições e contraste corrigidos, labels sem sobreposição e controles compactos no celular.
- Textos fixos apresentados como diagnóstico de IA foram retirados. Comparação usa pontos percentuais e tempo representa a média calculada. A tela distingue cadastro na loja de pagamento no checkout.

## Correções desta continuação

1. **Confirmação de rastreio persistente.** A conclusão com telefone e rastreio grava `whatsapp.message.requested` na mesma transação do pedido. O callback não chama mais o BubbleWhats diretamente. Foi ligado um consumidor de `order_tracking` à outbox; erro, configuração ausente ou ausência de aceite do provedor não produzem confirmação de entrega. A política existente controla retentativas e dead letter. Testes cobrem retentativa e ausência de duplicação. Aceite do gateway não prova entrega ao destinatário; falhas após aceite e antes do registro local ainda podem exigir reconciliação.
2. **Limite de intervenções.** O teste antigo ignorava a primeira intervenção de `payment_failed`. Agora verifica sua contagem e que nem outra falha prioritária ultrapassa o limite. A política da aplicação foi preservada.
3. **Stripe opcional no startup.** O construtor exigia chave Stripe mesmo quando o provedor não era usado. A API agora inicia sem ela; o webhook retorna 503 enquanto não configurado. Assinatura continua obrigatória quando configurado.
4. **Moeda do callback Stripe.** Foi reproduzida aprovação indevida de callback em USD para intenção BRL com o mesmo valor numérico. O handler agora rejeita com `stripe_currency_mismatch` antes de alterar o pagamento. Testes validam ausência de mutação e permitem repetir o evento corrigido.
5. **Fixtures Stripe atualizados.** Os cenários de compra agora persistem frete/autenticação confiáveis, consultam a aprovação persistida, incluem a taxa do comprador no total e usam chaves fictícias próprias, restauradas ao final.
6. **Histórico efetivo de deploy.** `prisma.config.ts` usa `prisma/deploy-migrations`, enquanto sete migrações necessárias estavam apenas em `prisma/migrations`. Elas foram copiadas sem modificar seu SQL: claims de recuperação, cancelamento agendado, cotas de pedidos, autoridade de cobrança, sincronização ERP, versões de templates e consentimento de campanhas. Foram testadas tanto após a base anterior quanto na sequência completa desde zero. O SQL de ERP e templates inclui atualizações de dados já previstas nas migrações originais; deve fazer parte da revisão da versão a publicar.

As duas falhas registradas na primeira etapa estão resolvidas. A falha da DLL do Prisma em uso no diretório principal foi contornada com geração e build em instalação isolada, sem encerrar processos do usuário.

## Limites e verificações de produção pendentes

1. **Fluxo externo completo.** Não existe homologação. Ainda falta uma compra controlada com o gateway efetivamente usado, desde autenticação/OTP do comprador e frete até criação da intenção no provedor, callback entregue pelo próprio provedor, pedido e dashboard. O teste local de callback usa intenções preparadas no banco e assinaturas produzidas localmente; não comprova cobrança, liquidação, recebimento de webhook externo nem entrega de email/WhatsApp. CAPTCHA e respostas de IA também não foram exercitados externamente.
2. **Configuração do destino.** O startup validado usa segredos fictícios, Redis e PostgreSQL descartáveis. Não confirma URLs, credenciais, origens CORS, configuração do CAPTCHA, workers ou saúde de um deployment de produção.
3. **Diferenças residuais de schema.** Depois das 27 migrações, a comparação com Prisma ainda aponta diferenças anteriores no catálogo/APL: ações de atualização de chaves estrangeiras, JSON/JSONB, defaults e definições/nomes de índices, além de defaults em tabelas de pagamentos/observações. As tabelas e colunas funcionais ausentes nesta continuação foram incluídas; não foi aplicado automaticamente o SQL de diferenças residuais. Revisar antes de declarar todo o monorepo pronto.
4. **Eventos históricos.** O bloqueio protege novas requisições públicas. Eventos antigos de conclusão precisam ser reconciliados com pedidos e pagamentos persistidos.
5. **Identidade e dispositivo.** A identificação de comprador recorrente entre novas conversas e a cobertura de metadados de dispositivo ainda precisam da jornada real. “Não informado” mantém visíveis as sessões sem metadados.

## Evidências e reprodução

- `apps/api/tests/funnel-followup-suite.log`: suíte final 122/122.
- `apps/api/tests/funnel-runtime-audit.cjs`: harness do Nest compilado, cadastro/login, funis e callback assinado. Aceita `--payment` para o cenário de pagamento. Usa exclusivamente os endereços locais dos serviços descartáveis e recusa a cópia se encontrar `.env` da aplicação.
- `apps/api/test-results/funnel-release/build-audit.log`: build completo, saída 0.
- `apps/api/test-results/funnel-release/migrations-fresh.log`: deploy seguro desde banco vazio, 27 migrações.
- `apps/api/test-results/funnel-release/startup-audit.json`: verificações HTTP com Stripe desativado.
- `apps/api/test-results/funnel-release/payment-runtime.json`: verificações do callback, pedido e conversão.
- `apps/api/test-results/funnel-release/schema-diff-after.log`: diferenças residuais de schema, somente diagnóstico.
- `apps/dashboard/test-results/funnel-audit/result.json`, `checkout.csv`, `checkout-desktop.png`, `checkout-mobile.png`, `checkout-mobile-chart.png`: navegador e exportação da primeira etapa.

Cópia de build e runtime: `C:\Users\Admin\AppData\Local\Temp\zyon-funnel-release-20260914`. Instalação pelo lockfile, offline, sem copiar arquivos `.env`. Os fontes executáveis da API e pacotes foram comparados ao diretório principal; as diferenças observadas eram caches/documentação local e artefatos excluídos da cópia.

Serviços de teste: contêiner `zyon-funnel-audit-20260914`, PostgreSQL em `127.0.0.1:55441`, bancos `funnel_audit`, `funnel_release` e `funnel_release_fresh`; contêiner `zyon-funnel-redis-audit-20260914`, Redis em `127.0.0.1:56381`. A API temporária usa porta 5317 e é encerrada pelo harness.

```powershell
# Após iniciar os dois contêineres descartáveis e preparar o build isolado:
node apps/api/tests/funnel-runtime-audit.cjs
node apps/api/tests/funnel-runtime-audit.cjs --payment
```

O harness assume a cópia temporária indicada acima; `FUNNEL_RUNTIME_ROOT` permite indicar outra cópia limpa já compilada. Não aponta para a API publicada. As suítes de banco da primeira etapa continuam opt-in com `FUNNEL_DB_TESTS=1`; `READY_PROD_TEST_PRISMA_CLIENT` pode indicar um cliente Prisma gerado separadamente.

## Recuperação anterior do ambiente

Com autorização expressa do usuário, 114 arquivos versionados ausentes foram restaurados do índice Git, sem sobrescrever arquivos existentes. Essa recuperação não representa backup de alterações não commitadas. As dependências foram reconstituídas pelo lockfile; alterações geradas em dependências versionadas do SDK foram desfeitas. A verificação final não encontrou arquivos de pacotes versionados ainda ausentes.
