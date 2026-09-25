# Tema e modo de cotação — validação local

Data: 25/09/2026. Projeto: AACP/Zyon.
Branch: `fix/theme-budget-storefront-20260925`, baseada em `e82acb4`.

## Comportamento corrigido

- A aba Orçamento carrega e salva a configuração nos campos já existentes do lojista. A API pública, a storefront e o agente consultam a mesma configuração.
- O carrinho envia nome, email, telefone e observação ao endpoint de orçamento. A API verifica a autorização da conversa e utiliza os itens e valores do carrinho no servidor. A solicitação e o aviso no painel são gravados juntos.
- As solicitações podem ser consultadas, aprovadas ou recusadas em Configurações da Loja > Orçamento. Essas ações atualizam o status interno; não enviam uma resposta automática ao comprador.
- O modo de cotação evita iniciar pagamento e OneBuyClick. Uma falha no envio mantém o carrinho e mostra uma mensagem para tentar novamente. A confirmação depende da resposta da API.
- A prévia de tema reage imediatamente à largura, ao arredondamento (inclusive zero) e aos modos Dark, Grey e Light. Prévia, storefront e checkout utilizam o mesmo mapeamento de estilos. Na storefront, o carregamento do JavaScript preserva as cores recebidas do servidor.
- O checkout adapta a barra lateral à largura disponível do próprio widget. O tema salvo se aplica ao carregar novamente a loja; não foi adicionado envio de mudanças para visitantes que já estão com a página aberta.

## Verificações aprovadas

| Verificação | Resultado |
| --- | --- |
| API: integração de configuração, orçamento, autorização e bloqueio de pagamento; regressão de OneBuyClick | 8/8 na execução final focada |
| Testes existentes da página de tema | 38/38 |
| Playwright com os componentes reais do painel, carrinho e widget | 4/4; larguras de tela de 390 e 1440 px |
| Playwright na aplicação Next compilada | 2/2; tema após hidratação, centralização e solicitação pelo proxy HTTP real |
| TypeScript da API, painel e storefront | Aprovado |
| Builds do painel, widget e storefront | Aprovados |
| `git diff --check` | Aprovado |

Os testes de API usam repositórios/Prisma em memória. Os testes de navegador usam dados sintéticos e uma API local de teste. A suíte Next exerce a página completa e o proxy, mas não conecta ao banco de produção. Não houve publicação, cobrança nem envio externo de email/WhatsApp. A notificação implementada é a do painel; os contatos de orçamento são persistidos, sem promessa de entrega por esses canais.

## Reprodução

Na raiz, após instalar as dependências e gerar o cliente Prisma da API:

```powershell
pnpm --filter @zyon/shared-types build
pnpm --filter @zyon/dashboard build
pnpm --filter @zyon/widget-v2 build
pnpm --filter @zyon/storefront build
```

Em `apps/api`:

```powershell
node --loader ./tests/ready-prod-loader.mjs --test --test-force-exit ./src/modules/storefront/application/use-cases/budget-mode.integration.spec.ts ./src/modules/storefront/infrastructure/tool-handlers/one-buy-click-cart-flow.spec.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

Em `apps/dashboard`:

```powershell
pnpm exec vitest run src/pages/theme-page.spec.ts
```

Em `apps/storefront` (Chromium do Playwright instalado):

```powershell
pnpm exec playwright test --config e2e/theme-budget.playwright.config.ts
pnpm exec playwright test --config e2e/theme-budget-next.playwright.config.ts
```

A suíte Next exige o build anterior e as portas locais 5198 e 5201 livres. A suíte de componentes usa a porta 5197. As consultas públicas usam a API sintética; fontes externas são bloqueadas nos testes para evitar dependência de rede.

## Capturas

- [Prévia com modo Grey e cantos de 24 px](theme-budget-evidence/theme-preview.png)
- [Confirmação de orçamento na storefront completa em celular](theme-budget-evidence/storefront-quote-success.png)
