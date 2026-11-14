# Cashback: implementação local

Data: 14/11/2026. Projeto: Zyon/AACP. Estado: código implementado e revisado localmente; validação formal de release pendente. Nenhuma loja real foi ativada.

Extensão aprovada e implementada depois deste inventário: [combinação com cupons e regras avançadas](cashback-combinations-2026-11-14.md), com permissões independentes, teto conjunto e redução automática de cashback. Os números abaixo descrevem a validação original; o documento da extensão registra a regressão consolidada e os controles atuais.

## Comportamento entregue

- Cashback é crédito promocional em BRL para novas compras na mesma loja, disponível em todos os planos.
- Site e WhatsApp usam a mesma conta canônica e a mesma carteira por loja. Ganhar em um canal permite usar no outro.
- O programa começa desativado. Percentuais, mínimos, tetos, orçamento, marco de liberação, carência, validade, combinação com descontos e regulamento exigem escolhas explícitas do lojista. Exemplos de testes não preenchem lojas reais.
- Produtos físicos, serviços, digitais e comida do catálogo próprio participam desde esta versão.
- O lojista pode salvar rascunho, revisar e publicar, pausar ou encerrar novos ganhos. Créditos existentes e compromissos de pagamentos anteriores continuam sendo honrados.
- O painel oferece métricas por período, estoque atual de saldo, clientes, filtros, paginação, extrato, exportação CSV e ajustes com motivo, autor e chave de idempotência.
- O comprador consulta saldo disponível, pendente, reservado, vencimento e extrato sem consentir com memória comportamental. O checkout permite escolher um valor e remover o crédito antes do pagamento.

## Conta única e primeira vinculação

O vínculo não usa o telefone livre do perfil como prova. A conta autenticada pode solicitar e confirmar um código no WhatsApp; a confirmação persiste a prova de posse e associa a identidade anterior do canal à conta do site. Login por código de telefone também registra esse vínculo, usando a conta canônica existente.

A opção de vincular continua disponível quando a carteira inicial retorna 403. Após confirmar o código, saldo e extrato recarregam automaticamente. Uma prova já persistida permite recuperar a carteira mesmo se o processo anterior parou antes da migração dos aliases.

Lotes, reservas e promessas passam a atender a conta canônica. O extrato financeiro histórico preserva seus lançamentos originais. Duas contas já estabelecidas não são fundidas automaticamente; um telefone já vinculado a outra conta é bloqueado.

## Garantias financeiras

Valores são calculados em centavos. Cashback incide sobre produtos líquidos elegíveis e não gera crédito sobre frete, taxas ou a parcela paga com cashback. Frete e taxa da plataforma permanecem separados na cobrança externa, que continua positiva nesta versão.

Transações PostgreSQL serializam reservas e orçamento por loja. Efeitos e recibos são persistidos juntos; reprocessamento não duplica movimentos. O consumo prioriza os lotes com vencimento mais próximo. Pagamento pendente ou incerto mantém o crédito indisponível para outro checkout.

As regras e alocações são congeladas com o pagamento. Alterações incompatíveis de carrinho invalidam a reserva. A projeção exibida pelo navegador não autoriza a cobrança. Compras digitais e serviços ignoram frete remanescente de um carrinho físico anterior.

Devoluções restituem uso e revertem ganho pelas alocações originais. Uma devolução integral restitui a captura externa completa, inclusive a taxa do comprador. Uma operação durável por pedido precede o envio ao provedor, impedindo reembolsos concorrentes da mesma parcela. Resultado pendente ou incerto exige conciliação.

Reembolso integral confirmado diretamente no provedor e chargeback definitivamente perdido também compensam o cashback, sem novo pedido de reembolso ao PSP. Disputa pendente não autoriza essa compensação. A rotina recupera falhas entre a persistência do pagamento e o efeito no cashback. Ganho revogado e já consumido registra perda promocional da loja, sem dívida oculta do comprador.

A carência usa o marco persistido do pedido, inclusive após recuperação tardia. A conciliação reporta divergências entre projeções, lotes e histórico; não apaga lançamentos para esconder diferenças.

## Canais e autorização

| Superfície | Rotas principais | Autoridade |
| --- | --- | --- |
| Painel | `/dashboard/cashback/program`, `/metrics`, `/customers`, `/transactions`, `/exports` | Sessão owner/admin da própria loja; nenhum gate por plano |
| Carteira | `/buyer/me/cashback`, `/buyer/me/cashback/transactions` | JWT do comprador e vínculo com a loja |
| Conta/WhatsApp | `/buyer/me/channels/whatsapp`, `/code`, `/verify` | Conta do JWT e código de posse com finalidade específica |
| Checkout | `/embed/cashback/quote`, `/reserve`, `/remove` | Token assinado da sessão; `payment:intents:read` para consulta e `offers:apply` para alterações |

O prefixo `/v1` é aplicado pelos clientes e configuração HTTP existentes. Identidade, preço e carrinho vêm do servidor. No WhatsApp, somente um pedido explícito com valor monetário aplica crédito; respostas genéricas ou menções ao produto não movimentam saldo. Valores formatados com milhares em reais também são aceitos sem ambiguidade.

Avisos de disponibilidade e vencimento usam templates promocionais específicos, inicialmente inativos. Vínculo de WhatsApp não concede marketing. Consentimento por loja/canal é verificado novamente antes de enviar, inclusive para eventual email de fallback. Aceitação incerta permanece no canal original e não dispara reenvio automático.

## Limites explícitos

- Sem saque, transferência ou saldo entre lojas.
- Carrinhos com vendedores externos e integrações de comércio que não suportam a alocação de cashback permanecem inelegíveis. O checkout sem cashback conserva o comportamento anterior.
- Uma devolução parcial informando somente variante e quantidade é rejeitada quando há linhas dessa variante com preços ou alocações unitárias diferentes, como opções de comida. A devolução integral do grupo permanece determinística.
- Não há prova de envio real, aceitação de provedor ou operação em produção. As jornadas de interface usam APIs simuladas identificadas; a persistência e as regras financeiras têm testes separados com PostgreSQL real local.

## Validação registrada

- 84 testes de API, domínio, PostgreSQL, identidade, autorização, pagamento, devolução e comunicação passaram, sem testes ignorados.
- 13 testes do painel e permissões e 7 testes do widget passaram.
- Jornadas em navegador: 12 do painel, 4 do checkout, 5 da carteira/vinculação e 1 reprodução independente da primeira vinculação. Desktop de 1440px e celular de 390px.
- Revisão independente reproduziu e verificou a correção de sete falhas. Três mutações financeiras foram detectadas: base de ganho incorreta, remoção do isolamento por loja e liberação indevida de pagamento pendente. As mutações ocorreram em memória, com hashes dos arquivos iguais antes e depois.
- Schema Prisma validado e três pares de migrações idênticos: `20261114091000_buyer_verified_phones`, `20261114120000_cashback` e `20261114130000_cashback_notifications`.
- Na comparação de regressões selecionadas, a baseline teve 101/102 testes passando e a versão atual 103/104. A mesma falha preexistente de expressão regular do catálogo de templates permaneceu; dois novos casos vêm dos novos templates de cashback. Nenhum teste antigo foi enfraquecido.

As provas, logs, screenshots, manifests e relatório independente estão em `.specs/features/cashback/`, ignorado pelo Git conforme a configuração existente do repositório.

## Pendências de release

O typecheck do storefront permanece bloqueado pelo erro preexistente de `AgentTab.tsx:32`: propriedades de `InlineCheckout` incompatíveis. O erro foi reproduzido com snapshots anteriores ao cashback, sem reverter arquivos do workspace. API, painel e widget têm verificações de tipos próprias registradas.

O gate formal não está aprovado: o workspace contém mais de duas mil alterações preexistentes e a implementação permanece sem commits, com build global bloqueado pelo erro acima. As mutações independentes têm evidência própria; o relatório não as apresenta como execução do mecanismo `mutate.py`. `releaseReady: false`.

Não houve push, deploy, migração remota, ativação em merchant real ou comunicação com clientes. As migrações são aditivas e não semeiam regras comerciais ou créditos.

## Referência de integração consultada

A separação entre estorno integral e parcial foi conferida na documentação oficial de [eventos para cobranças do Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas). Essa consulta documental não constitui prova de execução no provedor.
