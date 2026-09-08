# Identidade autenticada do comprador no início do embed

## Problema e contrato

O comprador validado no storefront por OTP de e-mail chegava ao checkout como anônimo. Enviar `global_user_id` ou flags `email_verified` no corpo não constitui autenticação. O `POST /embed/start` agora aceita o campo opcional `buyer_access_token` e verifica sua assinatura, expiração, formato dos claims, audiência, perfil de comprador e eventual restrição de lojista. A conta é relida por identificador global; o e-mail do token deve coincidir com o e-mail atual da conta.

`ResolveEmbedBuyerService` devolve contexto interno para `StartCheckoutUseCase`, com identidade e dados da conta obtidos pelo repositório. Somente o e-mail é marcado como verificado. Telefone e endereço são dados cadastrais, sujeitos às regras de contato e confirmação do checkout. Os controllers não acessam Prisma. O token é removido antes de encaminhar o pedido e incluído na configuração de ocultação dos logs HTTP.

## Vínculo da sessão

O token embed continua definindo uma única sessão. A criação usa operação atômica que conserva a sessão existente; um segundo comprador não sobrescreve o vencedor de starts simultâneos. Reentrada autenticada exige a mesma identidade e e-mail. Sem prova do comprador, o start não retorna uma sessão com e-mail autenticado.

Se o checkout já começou anonimamente e depois o comprador se autenticar, o frontend deve obter **novo token embed** antes do próximo start. A sessão anônima não é promovida nem reassociada pelo endpoint. O erro de tentativa de troca é `checkout_buyer_session_binding_mismatch`.

Sem token, o caminho anônimo permanece disponível. Token fornecido inválido, expirado, malformado, de outro lojista, de conta removida ou com e-mail desatualizado falha fechado. Identidade global e flags de verificação forjadas no corpo são ignoradas/sanitizadas também no start de checkout direto.

## Validação local

Runner: `apps/api/src/embed-buyer-identity-test-runner.ts`. Compilação isolada, sem regenerar Prisma nem reiniciar a API:

```powershell
# Executar em apps/api
pnpm exec tsc -p tsconfig.build.json --outDir .audit/identity-validation --incremental false
node .audit/identity-validation/embed-buyer-identity-test-runner.js
```

Resultado executado: **compilação passou; 27 testes passaram, 0 falharam, 0 ignorados**. Saída local em `apps/api/.audit/identity-validation-results.log`.

O runner reúne autenticação/reentrada/corrida do bridge, contrato de carrinho nativo, regras de identidade por e-mail e extração de dados de contato, além da ocultação do bearer nos logs. Os testes de identidade usam contas e repositórios em memória; a operação PostgreSQL e o pagamento Stripe sandbox devem ser exercitados no fluxo de navegador local antes de declarar essa compra concluída.
