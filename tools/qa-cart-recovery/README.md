# Validação de UI e Cart Recovery

Os scripts usam os componentes React e o cliente HTTP reais com API simulada. Não enviam e-mails ou WhatsApp.

Em dois terminais, a partir da raiz do repositório:

~~~sh
node tools/qa-cart-recovery/qa-server.mjs
node tools/qa-cart-recovery/browser-qa.mjs
~~~

O servidor escuta somente em 127.0.0.1:5198. Requer Chromium do Playwright instalado. Evidências e cache ficam em .artifacts/ (ignorado pelo Git). Encerre o servidor depois do teste.

A matriz cobre salvamento de cada estratégia, erro sem perda da seleção, vínculo de cupom, validade/limite de uso, listas vazias, erro de carregamento, teclado, espaçamento e oito larguras entre 320 e 1440 px.

API, a partir de apps/api (PowerShell):

~~~powershell
$testFiles = rg --files src/modules/cart-recovery src/modules/whatsapp-templates src/modules/campaign-consent -g '*.spec.ts' -g '*.int-spec.ts' -g '!*.db.spec.ts'
node --loader ./tests/ready-prod-loader.mjs --test --test-force-exit $testFiles
~~~

O teste strategy-config.db.spec.ts é opt-in (CART_RECOVERY_DB_TESTS=1) e usa somente a URL descartável fixa documentada no arquivo, na porta 55439, banco recovery_qa. Ele cria uma tabela mínima para testar o repositório real, concorrência e rollback. Não valida as migrações completas nem lê DATABASE_URL.
