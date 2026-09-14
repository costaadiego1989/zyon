# UI do Dashboard e Cart Recovery — validação de 14/09/2026

## Resultado

Os cabeçalhos, divisores, tabs e estados vazios do dashboard foram padronizados. O painel de Cart Recovery agora salva uma única configuração atômica por ação, preserva vínculos de cupom/regra em falhas e concorrência, e apresenta estados de carregamento, erro e resultado de entrega de forma consistente.

O encaminhamento de recuperação está validado para e-mail e Meta/WhatsApp sob as pré-condições da conta do merchant. A configuração de uma estratégia ainda não materializa o respectivo benefício no checkout; portanto, as quatro opções não devem ser apresentadas como incentivos plenamente aplicados.

## Alterações entregues

- A regra compartilhada de layout elimina a margem duplicada entre `.page-head`, divisor e conteúdo; o intervalo efetivo é de 24 px nos contêineres flexíveis e não flexíveis.
- `TabBar` passou a ser a base das tabs e seletores segmentados: teclado, roving tabindex, papéis ARIA corretos e área de toque móvel. Páginas e filtros que mantinham implementações próprias foram migrados.
- Estados sem conteúdo usam `EmptyState` compartilhado em páginas de configurações, conexões, suporte, funil, finanças, FAQ de produto, experimentos, protocolo e categorias.
- Cart Recovery usa radio group acessível, mostra falhas de carregamento com nova tentativa e mantém a seleção/configuração confirmada pelo servidor quando uma gravação falha.
- A atualização de estratégia é parcial e transacional: não apaga cupom ou regra vinculados, sincroniza a preferência legada e trata conflito transitório do banco com tentativas limitadas.
- O scanner pausa a sessão quando falta configuração, cupom/regra ou configuração de estratégia; não troca silenciosamente pela estratégia automática. Frete grátis também respeita a política do merchant.

## Matriz de canal e estratégia

| Cenário | Resultado validado |
| --- | --- |
| Meta conectado, template de recovery aprovado no mesmo WABA e telefone autorizado | envia template Meta/WhatsApp e grava `whatsapp_template` após aceitação do provedor |
| Meta ausente, pendente, ou template não aprovado; e-mail autorizado | usa e-mail de fallback |
| Provedor com aceitação incerta ou exceção após despacho | grava `unknown`; não tenta e-mail nem reenvia em paralelo |
| Sem canal autorizado | não cria tentativa nem envia mensagem |
| Frete grátis | seleção persiste; o scanner só tenta quando a política permite frete grátis |
| Cross-sell | seleção e roteamento persistem |
| Cupom | seleção/vínculo válido persistem; cupom expirado ou sem usos restantes não aparece como opção |
| Regra avançada | seleção/vínculo de regra ativa persistem |

## Limite funcional que permanece

Os templates nativos de recuperação aceitam somente `buyerName`, `storeName` e `link`. O template Meta aprovado também precisa refletir essa estrutura. Assim, o encaminhamento está integrado, mas o texto final ainda não recebe cupom, produtos recomendados, frete ou a avaliação da regra.

Além disso, o link atual somente aponta para a retomada; ele não carrega uma autorização de uso único que aplique cupom, frete ou regra após revalidação do carrinho. Para fechar cada estratégia como benefício real, é necessário implementar uma autorização de retomada com validade, escopo do carrinho/merchant e consumo idempotente, então integrar o checkout e submeter os novos templates Meta. Não foi criado um atalho que prometa um benefício não aplicado.

O envio real continua pendente de um merchant autorizado, destinatários de teste e templates Meta efetivamente aprovados na conta desse merchant. Nenhuma mensagem real foi enviada durante esta validação.

## Evidências executadas

- API: suíte focada de Cart Recovery, templates WhatsApp e consentimento passou após as alterações. Inclui 20 combinações de estratégia/canal, consentimento, ausência de duplicação em resultado incerto, configuração parcial e os bloqueios do scanner.
- Banco: 5 cenários em PostgreSQL descartável passaram, cobrindo preservação de vínculos, sincronização de preferência, concorrência, rollback e isolamento de tenant. O teste é opt-in, usa somente `127.0.0.1:55439/recovery_qa` e não lê `DATABASE_URL`.
- Dashboard: 56 testes focados passaram; typecheck do dashboard passou em 14/09.
- Navegador local: 22 verificações passaram nas larguras 320, 360, 390, 430, 768, 1024, 1280 e 1440 px. Cobrem a gravação única das quatro estratégias, erros sem perda de estado, vínculo de cupom, filtros de validade/uso, tabs por teclado, Empty States, retry e ausência de overflow horizontal.

Os scripts reproduzíveis estão em `tools/qa-cart-recovery/`. Eles montam os componentes e cliente HTTP reais com uma API simulada local; não são uma prova de entrega por provedores externos.
