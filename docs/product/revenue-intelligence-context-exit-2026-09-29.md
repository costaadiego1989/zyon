# Revenue Intelligence — continuidade ao mudar o contexto da compra

Trigésima entrega local. Uma sessão participante que encontra uma condição ainda não suportada pelo experimento segue pelo checkout habitual, desde que a mensagem atual ainda não tenha sido admitida para uma chamada experimental. O comprador não recebe controles técnicos para sair do teste.

## Comportamento

A regra é idêntica nos grupos de controle e tratamento. Personalização consentida, produtos já encontrados pelo catálogo, configuração de criptomoeda, oferta autorizada, cupom, desconto e incentivo existente podem interromper novas respostas experimentais naquela sessão. Cadastro, escolha de pagamento e transições determinísticas continuam no roteamento que já existia.

A interrupção é permanente para a sessão. Retirar um cupom ou mudar uma configuração depois não a reinscreve. Outras sessões elegíveis continuam no experimento. A atribuição original, as mensagens já publicadas e as compras dentro da janela de conversão permanecem na comparação, incluindo sessões sem exposição experimental. Não há filtro de participantes baseado em resultado ou compra.

O fluxo reutiliza a oferta produzida pelo autorizador determinístico. Não concede incentivos por texto. Após a interrupção, não busca o prompt de outro experimento; mensagens seguintes também ignoram regras experimentais forçadas. Ferramentas que alteram o carrinho continuam indisponíveis nessa continuação enquanto não participarem da mesma proteção transacional; o comprador pode usar os controles normais do checkout.

## Concorrência e evidência

Antes da interrupção, a transação bloqueia loja, sessão e recibo, na ordem compatível com a admissão. Confere a identidade completa da mensagem, a versão do protocolo, seu estado em processamento e a ausência de chamada experimental ou resposta persistida para aquele recibo. O estado da sessão deve coincidir com o lido antes da autorização da oferta, incluindo os timestamps. Somente a intenção consentida transitória é retirada dessa comparação; ela não é gravada como motivo de interrupção.

Uma chamada já admitida impede esse caminho mesmo que ainda não tenha resposta. Tentativas incertas mantêm seu recibo e sua reserva financeira. Reenvios simultâneos não geram outra chamada. Alterações concorrentes no carrinho são detectadas antes da saída e novamente na gravação do fluxo normal. Não existe tratamento genérico de erro que redirecione para outro provedor.

A evidência utiliza o registro imutável de interrupção da participação, com um motivo fixo e horário do banco. Não armazena texto do comprador, perfil, código de cupom ou identificadores de produto no motivo. Não houve alteração de schema ou migration.

## Proposta e métricas

O baseline inclui `contextExit: checkout-context-exit-v1`, que faz parte do hash revisado. Baselines antigos ou com outra política não são reinterpretados; a execução exige uma proposta compatível. Os detalhes da nova proposta explicam ao lojista quando uma sessão seguirá sem o experimento. Essa explicação não aparece como se fizesse parte de propostas históricas sem o campo.

A coleta acrescenta `participation` com definição `strategy-participation-v1`, na mesma consulta que lê atribuições e resultados. O registro participa do hash da evidência. A leitura considera apenas interrupções registradas até `asOf`, mantém os grupos originais e não modifica snapshots anteriores.

O painel mostra **Sessões que seguiram sem o experimento** por grupo e explica a preservação das compras. Dados históricos ou definições desconhecidas não são exibidos como zero. As contagens não significam abandono e não são subtraídas do denominador de conversão.

## Validação local

- 23 cenários PostgreSQL novos passaram: seis condições nos dois grupos, permanência da atribuição, compras após a interrupção, corte temporal, medição imutável, publicação anterior, isolamento de outra sessão, tentativas incertas, retries concorrentes, carrinho concorrente, seis recusas de contexto/recibo, disputa com admissão e ferramentas comerciais.
- 19 testes de baseline, execução e medição passaram. A regressão de checkout/contexto/ofertas passou em 38 testes; um teste antigo permaneceu ignorado.
- A regressão integral passou nos 214 testes PostgreSQL de execução, incluindo os 23 novos cenários. TypeScript da API e do dashboard passou. Duas jornadas de navegador passaram em 1440 e 390 pixels, incluindo verificações de 320 pixels e zoom equivalente a 200%, com HTTP controlado.

Logs locais em `.audit/revenue-weekly/`: `context-exit-pg-final.log`, `context-exit-pg-full.log`, `context-exit-unit.log`, `context-exit-regression.log`, `context-exit-api-types-final.log`, `context-exit-dashboard-types-final.log` e `context-exit-browser-final.log`. Capturas em `context-exit-browser-final/`.

## Limites

Esta entrega mantém a compra em andamento quando o contexto sai do recorte suportado. Não implementa personalização ou ferramentas comerciais dentro do experimento. As chamadas do checkout habitual continuam fora da estimativa de chamadas fixadas da estratégia; custo integral de IA e contribuição líquida seguem indisponíveis.

A aprovação pública permanece indisponível. Ainda faltam execução comercial e paridade completas, proteção de todos os escritores concorrentes, economia integral, incentivos inteligentes, aprendizado compartilhado e piloto. Não houve implantação, alteração de flags de produção, contato com compradores, chamada a provedor real ou comprovação de ganho comercial.
