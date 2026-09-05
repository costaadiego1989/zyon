# Kong no Railway

O serviço `kong` fica no mesmo projeto Railway da API, PostgreSQL e Redis.
Não exige outra VPS. Cada serviço tem seu próprio container e consumo de recursos.

```text
Dashboard / widget_v2 / storefront / web (Vercel)
  → https://api.zyon-payments.com.br
  → Kong :8000 (Railway)
  → http://api.railway.internal:3009
  → PostgreSQL / Redis (rede privada do Railway)
```

Kong funciona sem banco de configuração (`KONG_DATABASE=off`). O arquivo
`render-config.lua` gera a configuração declarativa a partir das variáveis.
O arquivo antigo `kong/kong.yml` não é carregado. Admin API e Admin GUI estão
desabilitadas; somente a porta de proxy 8000 recebe tráfego público.

## Variáveis do serviço Kong

| Variável | Valor de produção |
| --- | --- |
| `PORT` | `8000` |
| `UPSTREAM_API_HOST` | `api.railway.internal` |
| `UPSTREAM_API_PORT` | `3009` |
| `GATEWAY_RATE_LIMIT_POLICY` | `redis` |
| `GATEWAY_REDIS_HOST` | `redis.railway.internal` |
| `GATEWAY_REDIS_PORT` | `6379` |
| `GATEWAY_REDIS_DATABASE` | `1` |
| `GATEWAY_CORS_ORIGINS` | URLs HTTPS de app, widget, storefront, www e domínio raiz |
| `KONG_TRUSTED_IPS` | `0.0.0.0/0,::/0` |
| `KONG_REAL_IP_HEADER` | `X-Real-IP` |
| `KONG_REAL_IP_RECURSIVE` | `off` |
| `KONG_DNS_ORDER` | `LAST,SRV,A,AAAA,CNAME` |

A configuração de IP pressupõe a entrada pública pelo proxy HTTP do Railway,
que fornece `X-Real-IP`. Não exponha esse container diretamente por TCP mantendo
essa confiança. Foi verificado que cabeçalhos `X-Real-IP` e `X-Forwarded-For`
forjados pelo cliente não mudam o contador de limite nessa entrada do Railway.

O Redis atual usa somente rede privada. Se for configurada autenticação nele,
defina também `GATEWAY_REDIS_PASSWORD` no Kong. A base 1 separa os contadores do
gateway da base usada pela API.

## Comportamento

- Rotas normais: 120 requisições/minuto e 3.600/hora por IP.
- `/auth` e `/v1/auth`: 30/minuto e 300/hora por IP.
- `/health`, `/ready` e suas variantes `/v1`: sem limite, para monitoramento.
- Os limites são ajustáveis por `GATEWAY_RATE_MINUTE`, `GATEWAY_RATE_HOUR`,
  `GATEWAY_AUTH_MINUTE` e `GATEWAY_AUTH_HOUR`.
- CORS permite apenas os domínios configurados, incluindo respostas HTTP 429.
- Payload máximo: 10 MB. Timeout de leitura da API: 180 segundos.
- Caminhos `/v1`, Authorization, cookies, corpos e assinaturas de webhook são
  encaminhados à API. Não há cache nem repetição automática de requisições.
- WebSockets passam pelo gateway; autenticação e autorização continuam na API.
- Se o Redis ficar indisponível, rotas com limite falham em vez de liberar
  requisições sem contagem (`fault_tolerant=false`).

Estes limites são por IP e não implementam cotas por plano ou por lojista.
`/ready` é encaminhado à API, que verifica PostgreSQL e Redis.

## Publicar

Na raiz do repositório:

```powershell
railway.cmd up infra/kong --path-as-root --project b8421237-6557-4677-a08c-c93453b08568 --service 33b9aaba-2aa3-4b18-94dd-bdf7d3639127 --environment production --detach
```

Build: `Dockerfile` dessa pasta. Healthcheck: `/ready`, timeout 120 segundos.
Domínio de diagnóstico: `https://kong-production-c91a.up.railway.app`.
O domínio público da API deve ficar associado ao serviço **Kong**, porta 8000.
O serviço API fica sem domínios públicos e usa `TRUST_PROXY_HOPS=1` para
reconhecer o IP e o protocolo HTTPS encaminhados pelo gateway.
Preserve no DNS da Vercel o CNAME `api` e TXT `_railway-verify.api` fornecidos
pelo Railway. As envs dos frontends continuam com `https://api.zyon-payments.com.br`.

## Executar localmente

Com a API disponível na porta 3009 do host:

```powershell
docker compose -f docker-compose.kong.yml up -d --build
Invoke-RestMethod http://localhost:8000/ready
```

O Compose local publica somente `127.0.0.1:8000` e usa contadores locais.
O deploy Railway usa os mesmos arquivos com Redis e origens de produção.

## Validação desta publicação

Em containers descartáveis com API de teste e Redis: caminhos preservados,
Authorization, CORS, corpo e assinatura de webhook, WebSocket HTTP 101,
limite HTTP 429 e readiness disponível depois de atingir o limite.
No Railway: readiness da API pelo endereço privado e contador Redis por IP,
incluindo tentativas de falsificar cabeçalhos de IP.
Após a transferência do domínio: certificado HTTPS válido, DNS propagado,
health/readiness HTTP 200 e CORS correto. Dashboard, widget_v2, storefront e
site responderam HTTP 200 no Chromium, sem exceções de JavaScript, com acesso
à API nos três aplicativos e rejeição de token inválido no widget.
