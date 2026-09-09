# WhatsApp oficial via Meta Cloud API

## Estado operacional no Meta Business Suite

Em 09/09/2026, o administrador configurou uma forma de pagamento na conta **Zyon Agentic Commerce** (`1106192625396654`). Essa conta ainda nao possui numeros de telefone, portanto esta pronta para receber o novo chip pelo Embedded Signup quando ele estiver disponivel.

A conta **Zyon Commerce** (`1053794637507910`) esta sem forma de pagamento. Enquanto essa configuracao permanecer assim, o novo numero deve ser conectado a **Zyon Agentic Commerce**. Nao reutilizar o numero anterior que apresentou o erro Meta `#2655122`.

O Configuration ID ja criado para o Embedded Signup e `869983652735597`. Ele deve ser usado como `META_EMBEDDED_SIGNUP_CONFIGURATION_ID` somente junto da publicacao revisada da API e das demais variaveis de producao listadas abaixo.

Data: 09/09/2026. Escopo: API, dashboard, recuperação de carrinho e mensagens pós-venda da Zyon.

## Decisão

Novas conexões usam a **Meta Cloud API direta**. O Embedded Signup da Meta entrega a autorização, a WABA e o `phone_number_id`; a API valida esses ativos no Graph API, inscreve a WABA no app e armazena o token de cada merchant criptografado.

Não há Partner Solution ID, subconta ou cadastro manual de telefone. Integrações Twilio existentes permanecem legíveis apenas para não interromper lojas já conectadas; o dashboard não oferece mais esse caminho para novas conexões.

## Comportamento implementado

- O popup oficial da Meta é a única etapa de seleção e confirmação do número.
- O código de autorização é trocado no servidor. Tokens nunca retornam ao navegador.
- O servidor confirma que a WABA e o `phone_number_id` escolhidos pertencem à autorização recebida.
- A WABA só fica ativa depois de `subscribed_apps` confirmar a assinatura do app.
- Se a resposta externa for desconhecida, a conexão fica em provisionamento e desativada até a reconciliação; não há nova inscrição automática.
- Desconectar remove o token do merchant e interrompe envios locais.
- Templates são enviados e sincronizados diretamente no Graph API. O identificador Meta é determinístico, o que permite reconciliar timeouts sem criar duplicatas às cegas.
- Recuperação de carrinho e pós-venda usam exclusivamente a conexão Meta ativa do merchant. Sem conexão ou template aprovado, usam e-mail; uma recusa confirmada no Graph API também permite somente um fallback por e-mail.
- O webhook valida o HMAC `X-Hub-Signature-256`, roteia mensagens pelo `phone_number_id` e só processa canais ativos.

## Variáveis de produção

No serviço API, configurar valores do mesmo app Meta:

```dotenv
META_EMBEDDED_SIGNUP_APP_ID=2277752126311176
META_EMBEDDED_SIGNUP_CONFIGURATION_ID=<configuration-id-do-embedded-signup>
META_APP_SECRET=<app-secret>
META_WEBHOOK_VERIFY_TOKEN=<valor-aleatorio-longo>
POST_SALE_WHATSAPP_PROVIDER=meta
API_PUBLIC_URL=https://api.zyon-payments.com.br
```

`POST_SALE_WHATSAPP_PROVIDER=meta` deve ser aplicado somente depois que o app Meta, webhook, templates aprovados e conexao do merchant estiverem prontos em producao. Antes desse gate, manter `POST_SALE_WHATSAPP_PROVIDER=email` para nao interromper pos-venda e recuperacao por e-mail durante deploys parciais.

`AACP_PII_ENC_KEY` já é obrigatória para persistir dados sensíveis e também protege o token Meta da loja. Ela não pode ser trocada sem um plano de rotação.

## Configuração no app Zyon Prod

1. Manter o app **Zyon Prod** como **Independent Tech Provider** e aguardar a verificação empresarial e a análise das permissões solicitadas pela Meta.
2. Em **Facebook Login for Business**, criar ou confirmar a configuração do Embedded Signup e copiar o Configuration ID para `META_EMBEDDED_SIGNUP_CONFIGURATION_ID`.
3. Registrar a URL pública do dashboard nos domínios permitidos da configuração do login.
4. Em **WhatsApp > Configuration**, cadastrar o callback `https://api.zyon-payments.com.br/v1/webhooks/whatsapp/meta` e usar exatamente o mesmo `META_WEBHOOK_VERIFY_TOKEN` configurado no serviço API. Assinar o campo `messages`.
5. Depois da aprovação e da publicação do app, conectar um número novo pelo dashboard. O número deve estar livre de vínculo prévio com WhatsApp; o erro Meta `#2655122` do número anterior indica um cadastro residual e não deve ser repetido.
6. Confirmar no dashboard o estado ativo, criar um template de teste e validar recebimento e envio antes de liberar campanhas.

Nenhuma chave de produção, configuração da Meta ou cadastro de número foi alterado por este trabalho.

## Validação executada

Em 09/09/2026, a bateria local passou com **94 testes** e 1 suíte PostgreSQL explicitamente ignorada por não receber URL de banco de teste. Ela cobre autorização e validação de ativos, inscrição e reconciliação de WABA, criptografia de token, isolamento por merchant, webhook HMAC, respostas conversacionais, templates Meta, recuperação, pós-venda e fallback seguro para e-mail.

Também passaram o build da API e o build do dashboard. O dashboard executou 10 testes para o popup do Embedded Signup, incluindo validação rígida da origem e dos eventos recebidos.

Ainda falta a validação de entrega real após a aprovação da Meta e a disponibilidade de um chip novo. Os testes locais simulam Graph API e não comprovam envio de mensagem em produção.
