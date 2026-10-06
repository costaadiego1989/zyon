# CAPTCHA e cota de mensagens da IA

## Configuração

- API: `TURNSTILE_SECRET_KEY` e `REDIS_URL` em produção. `JWT_SECRET` deve ter pelo menos 32 caracteres, como exigido pelas capacidades de conversa e voz.
- Dashboard: `VITE_TURNSTILE_SITE_KEY`.
- Storefront e checkout hospedado: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- API: `TURNSTILE_ALLOWED_HOSTNAMES` pode listar os hosts permitidos, separados por vírgula. Inclua os hosts usados pelos formulários.

Em produção, autenticação e recuperação recusam CAPTCHA ausente ou configuração indisponível. Desenvolvimento sem configuração permite testes locais; desenvolvimento configurado valida normalmente.

O cliente envia `turnstile_token` em cada tentativa. A API valida assinatura pelo Siteverify, ação e, quando configurado, hostname. O formulário solicita outro desafio após erro, expiração ou consumo. Login e recuperação por OTP também exigem um desafio novo entre envio e confirmação. O widget usa o tamanho compacto quando a largura disponível fica abaixo de 300px.

Referência: [validação no servidor](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) e [tamanhos do widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/).

## Cota por usuário

A cota admite 10 mensagens por janela de 60 segundos, compartilhadas entre HTTP, socket, storefront, checkout, suporte com IA e voz. A chave Redis usa `ai:user:<hash da identidade>`; mudar conversa, compra ou loja preserva a cota nos clientes que mantêm a credencial do visitante. O contador e a expiração são atômicos entre réplicas. A janela começa na primeira mensagem e renova após 60 segundos; não é uma janela móvel.

Contas autenticadas usam o identificador global verificado do comprador. Visitantes usam uma credencial assinada persistida no navegador e propagada às capacidades do checkout. O identificador interno de uma compra anônima não substitui essa identidade. Uma credencial anônima identifica o navegador: apagar o armazenamento ou trocar de dispositivo cria outra identidade; a conta autenticada permite aplicar a mesma cota entre dispositivos.

Integrações legadas da API sem credencial de visitante usam a identidade verificada do checkout persistido ou, enquanto anônimas, a sessão persistida. Para compartilhar a cota entre compras anônimas de uma integração, envie a credencial assinada em `X-AI-User-Token`.

Os limites e configurações globais de Kong, IP e tenant continuam independentes. A aplicação retorna `429`, código `ai_interaction_rate_limited`, `retry_after_seconds` e `Retry-After` quando o usuário esgota sua cota. Os cabeçalhos específicos usam `X-AI-RateLimit-*`, sem substituir os cabeçalhos globais. Redis indisponível recusa a interação com `503`.

Sugestões automáticas têm uma cota separada de duas por minuto por identidade, preservando as dez mensagens manuais. A permissão de voz do plano continua sendo verificada antes da abertura de uma chamada.

## Voz

O servidor cria a chamada Realtime enviando SDP e configuração em formulário multipart, e conecta um WebSocket de controle à chamada. A geração automática fica desativada; cada mensagem de texto ou áudio é admitida pelo contador antes de o servidor solicitar uma resposta. Eventos repetidos não consomem duas mensagens. Geração iniciada sem autorização provoca cancelamento e encerramento da chamada.

O encaminhamento ao agente comercial inclui uma autorização assinada vinculada ao usuário, loja e conversa. Ela pode ser consumida uma única vez, para não contar a mesma mensagem de voz novamente na rota HTTP. Continuações de ferramentas ficam limitadas a três por turno. A sessão tem duração máxima de 30 minutos e é encerrada durante desligamento da API.

Referência: [criação de chamada Realtime](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create) e [controle de chamadas pelo servidor](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime).

## Evidência local

Os testes cobrem CAPTCHA ausente, inválido, reutilizado e configuração indisponível; formulários React no Chromium com provedor simulado; identidade e renovação de capacidades; texto e voz compartilhando a cota; concorrência com Redis real em duas instâncias; e conexão HTTP/WebSocket com servidor Realtime local.

Esses testes não comprovam uma chamada real à OpenAI, um desafio real da Cloudflare ou o comportamento de uma implantação em produção. Para uma liberação, valide esses fluxos no ambiente de destino com as chaves e os domínios configurados.
