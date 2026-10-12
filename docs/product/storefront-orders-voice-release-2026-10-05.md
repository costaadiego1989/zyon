# Pedidos e controle de voz no campo de mensagem

## Comportamento

A revisão de produto `8931e205be556d94ef9b2506ac583039eea639fe` reorganiza Pedidos em uma lista com separadores, nome da loja, data e total. Os itens apresentam quantidade, preço unitário e valor da linha; pedidos com mais de três itens têm expansão acessível pelo teclado. O desconto aparece somente quando registrado no histórico e a forma de pagamento usa rótulos conhecidos. Dados ausentes não viram zero, pagamento confirmado ou identificadores técnicos.

Compras digitais, físicas e mistas permanecem em Pedidos. A tela não interpreta `tracking_status` como estado da compra; entrega e histórico de transporte ficam em Rastreio. O total registrado pode conter componentes que não estão na projeção de itens e não é recalculado pela interface.

O carregamento usa o GET existente `/v1/buyer/me/purchases`, com comprador autenticado, loja atual e páginas de dez registros. Ao reabrir a conta ou entrar em Pedidos, consulta novamente a API. Respostas antigas são descartadas após mudança de loja, comprador, logout ou desmontagem. Falha na próxima página mantém os pedidos visíveis e permite repetir o mesmo cursor; registros repetidos não duplicam a lista. Loading, erro e lista vazia têm apresentações distintas.

O botão de compra por voz sai do cabeçalho e fica à esquerda do campo de mensagem, com área de toque de 44 px e nome acessível. No modo de voz, o mesmo botão permite voltar ao texto. A disponibilidade continua determinada pela configuração e pelo plano da loja. Permissão, conexão, reconexão, encerramento, quotas e integração Realtime permanecem nos hooks existentes. A posição nova não inicia uma sessão automaticamente.

## Impacto no sistema

Mudança restrita à storefront, seus testes e documentação. Não altera API, migrations, tabelas, valores financeiros, regras comerciais ou configuração de voz. Não acrescenta WebSocket ao Hub nem chamada à LLM para listar pedidos. Abrir ou reabrir Pedidos faz uma consulta autenticada de histórico, usando o endpoint que já existia. A operação de voz continua exigindo a ação explícita do comprador e as permissões existentes.

## Validação local e sandbox

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Pedidos no Hub local | 10/10; digitais/mistos, valores, teclado, estados e paginação; 390/1440 px, claro/escuro | `.audit/orders-ui-20261005.log` e capturas no diretório homônimo |
| Carregamento de pedidos | 4/4; isolamento por loja, falha/retry de página, logout e reabertura | Execução Playwright de `buyer-orders-guards.spec.ts` nesta sessão |
| Voz no Shell local | 6/6; posição, tamanho, temas, permissão negada, retorno ao texto e loja sem voz | Capturas em `.audit/voice-composer-20261005/`; execução do agente nesta sessão |
| Typecheck e build storefront | Aprovados | Execução TypeScript nesta sessão; `.audit/orders-voice-storefront-build.log` |
| Storefront sandbox | Railway `d051bcfe-ae31-4ee8-8730-be4fce264fb3`, SUCCESS; upload do arquivo Git completo do candidato `8931e20` | Candidato em `C:\tmp\zyon-revenue-integrated-8931e205be55` |
| Artefatos e interface pública do sandbox | 8/8 textos/atributos, 18 assets HTTP 200, 390/1440 px; voz somente no compositor, à esquerda; zero erros | `.audit/orders-voice-sandbox-public-artifacts.json` |
| Compradores autenticados no sandbox publicado | 12/12 cenários de navegador e 3/3 consultas da API; valores e itens corretos, digitais/físicos/mistos, voz no compositor; zero erros | `.audit/sandbox-revenue-planner-20261005/orders-voice-browser-2026-10-06T01-43-21-279Z/report.json` e 28 capturas |

A API do sandbox permanece em `afffcccf-bd65-4114-abf2-7c46d433e8d8`, Git `834340b`, SUCCESS e `/ready` HTTP 200 com banco conectado. Os arquivos da API são idênticos ao baseline; esta entrega não precisa republicá-la no sandbox. O commit `245ecc5` acrescenta somente a fixture e testes de voz, sem mudar os arquivos de execução do candidato.

O ensaio autenticado usou os três compradores sintéticos existentes, com 8/2/1 registros de histórico. Não criou dados financeiros nem iniciou pagamento ou sessão Realtime. A API respondeu normalmente, sem substituir respostas no navegador. Os dados existentes não exigem próxima página ou expansão acima de três itens; esses controles foram exercitados nos testes locais. Permissão negada e retorno ao texto passaram localmente; a rodada publicada final validou a posição e disponibilidade do botão, sem acionar a voz. Os estados conectado, ouvindo e falando não foram validados com provedor real.

## Promoção e conferência

O candidato só segue para o `master` após o PASS do sandbox autenticado e revisão das capturas. Testes e documentação acrescentados depois do upload não mudam os arquivos de execução da storefront, da API ou dos pacotes; essa equivalência é conferida por Git antes de promover.

A conferência de produção identifica a revisão Git no deployment da Vercel, seus aliases e a prontidão da API. O navegador público da Athom verifica os assets novos e o microfone no compositor em 390/1440 px, sem login de comprador ou sessão de voz. Os resultados finais ficam em `.audit/orders-voice-release.json` e `.audit/orders-voice-production-public-artifacts.json`. Essa conferência pública é distinta dos testes autenticados de Pedidos no sandbox.

## Limites e retorno

Fixtures locais substituem respostas da API; a validação publicada é registrada separadamente. Nenhuma evidência de interface demonstra pagamento real, encomenda real ou conexão com provedor de voz. Arquivos privados, credenciais e relatórios de execução ficam em `.audit`, ignorado pelo Git, e não entram no upload. A versão anterior de interface é `834340b`; a reversão deve seguir a mesma sequência de sandbox, validação e produção, sem rollback de banco.
