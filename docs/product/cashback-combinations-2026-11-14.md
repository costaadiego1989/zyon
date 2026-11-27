# Cashback com cupons e regras avançadas

Data: 14/11/2026. Projeto: Zyon/AACP. Implementação e revisão técnica locais concluídas; publicação e gate formal de release pendentes. Proposta aprovada pelo usuário: “perfeito gostei da sua sugestao”. Este documento complementa `cashback-implementation-2026-11-14.md`.

## Comportamento

O painel exige decisões independentes sobre aceitar cupons, aceitar regras avançadas e qual teto usar. O lojista informa pelo menos um limite conjunto: percentual dos produtos ou valor em reais. Informar os dois faz prevalecer o menor. As escolhas comerciais começam vazias.

- **Respeitar o teto geral:** os benefícios somados respeitam também o limite geral de descontos da loja.
- **Usar teto específico de cashback:** o limite conjunto explicitamente informado substitui somente o teto geral de desconto nessa composição. Saldo disponível, limite individual de resgate, pedido mínimo e margem mínima continuam valendo.

O sistema calcula cupom e regra pelos valores efetivos e aplica cashback por último. Se o espaço restante diminuir, uma reserva ainda livre de pagamento encolhe somente o necessário e devolve a diferença ao saldo. Um novo cupom ou regra que sozinho com os benefícios anteriores já ultrapassaria o teto é rejeitado; o sistema preserva os benefícios anteriormente autorizados.

Exemplo sem frete ou taxa:

| Componente | Valor |
| --- | ---: |
| Produtos | R$ 100,00 |
| Cupom | −R$ 10,00 |
| Regra avançada | −R$ 5,00 |
| Teto conjunto de descontos | R$ 30,00 |
| Cashback máximo restante | −R$ 15,00 |
| Valor a pagar | R$ 70,00 |
| Novo crédito a 5% sobre os produtos pagos | R$ 3,50 |

O resumo e o simulador do painel explicam as permissões e o teto escolhido. Sem o contexto do teto geral, o simulador pede esse dado em vez de inventar um resultado. O servidor continua responsável por autorizar a operação real.

## Site, WhatsApp e pagamentos

A mesma conta e carteira por loja do módulo-base continuam atendendo os dois canais. Site e WhatsApp usam a mesma composição de benefícios no servidor. No WhatsApp, comandos explícitos como `Aplicar cupom PROMO` e `Aplicar oferta` passam pelos casos de uso existentes; ofertas são recuperadas do histórico autorizado do servidor. Menções, perguntas e um “sim” genérico não aplicam descontos.

O checkout persiste a origem de cupom, regra de produtos e regra de frete em um registro transacional. O último rótulo exibido na interface não representa a autoridade financeira. Trocar a origem sem alterar o valor incrementa uma versão, invalida a cotação visual anterior e altera a identificação do carrinho usada pelo pagamento. Limpar o carrinho preserva o crescimento dessa versão.

Pagamentos pendentes ou incertos mantêm seu compromisso original. Alterar as regras do lojista não reescreve snapshots de pagamentos anteriores. Antes de reservar cupom, o servidor verifica mutabilidade e limites; uma rejeição concorrente compensa somente a nova reserva de cupom. O endpoint de aplicação também exige escopo de escrita no token assinado do checkout.

A revisão independente identificou e comprovou duas correções: selecionar outro frete não pode recuperar um preço antigo já descontado; uma mudança somente de frete deve persistir a nova identificação da reserva mesmo sem movimentação financeira, mantendo um cashback que ainda cabe no teto.

## Compatibilidade e persistência

Regras antigas continuam sendo interpretadas internamente pelo comportamento anterior. Uma nova publicação HTTP exige a política de combinação completa. Rascunhos e snapshots históricos permanecem compatíveis. A migração aditiva `20261114150000_cashback_combination` cria o registro e seus eventos; os arquivos normal e espelhado de deploy são idênticos. O schema Prisma foi validado com a conexão local exclusiva de testes. A migração não configura regras comerciais, ativa programas ou concede saldo.

## Evidências locais

- **162/162 testes de API:** política monetária, PostgreSQL real local, identidade, autorização, cupons, regras, carrinho, pagamentos, estornos e comandos WhatsApp. Nenhum teste ignorado.
- **19 testes do painel e 11 do widget:** formulário, contratos, permissões e atualização de cotação.
- **25 jornadas de navegador:** 20 do painel, em 1440px e 390px, e 5 do checkout. Componentes reais com respostas HTTP simuladas, incluindo revisão/publicação, validação, simulador e mudança de origem pelo chat.
- **Revisão independente:** seis provas próprias passaram; os dois achados foram corrigidos e retestados. Três mutações foram detectadas, com provas originais verdes e hashes dos arquivos preservados. As mutações ocorreram somente na memória de processos isolados, sem alegação de execução de `mutate.py`.
- **Tipos:** API, painel e widget passam nas verificações registradas. O storefront mantém o erro preexistente em `AgentTab.tsx:32`, já reproduzido com a baseline do módulo-base.
- **Lint:** as dez integrações alteradas conservam exatamente os dois diagnósticos arquiteturais anteriores de `checkout-experience.service.ts`; a comparação usa os snapshots anteriores à extensão. As fontes novas do backend, painel e widget passaram nas verificações focadas.

As evidências e comandos reproduzíveis estão em `.specs/features/cashback-stacking/`: `spec.md`, `tasks.md`, `verification.md`, `proofs.md`, manifests e logs. Essa pasta permanece ignorada pelo Git, conforme a configuração existente. A regressão consolidada pode ser executada com `node .specs/features/cashback-stacking/evidence/run-api-regression.mjs`.

O runner formal `check_proofs.py` aprovou C01–C08 e registrou a falha do build global somente no erro conhecido do storefront. O relatório independente mantém suas mutações em memória separadas da contagem do runner formal. `extension-files.json` e `extension-delta.patch` delimitam o que mudou desde os snapshots desta extensão.

## Limites de release

`releaseReady: false`. O gate formal de release não está aprovado: o workspace já continha extensas alterações concorrentes, os arquivos compartilhados ainda não têm commits isolados e o build global continua bloqueado pelo erro anterior do storefront. A aprovação técnica local do verificador não equivale a prova em HEAD limpo. Os dois diagnósticos de lint anteriores também estão explicitamente registrados.

Não houve push, deploy, migração remota, ativação de loja, envio a clientes ou execução real de Meta/PSP. Antes da publicação, será necessário consolidar os commits, resolver os bloqueios globais e validar a revisão servida, a migração e as jornadas reais no ambiente de destino.
