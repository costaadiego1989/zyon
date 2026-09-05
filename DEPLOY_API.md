# API: Docker Compose e Railway

Na raiz do monorepo, com Docker Desktop iniciado e Docker Compose 2.30 ou superior:

```powershell
docker compose up -d --build api
docker compose ps
Invoke-RestMethod http://localhost:3009/ready
```

O comando inicia a API, PostgreSQL e Redis. As migrations executam antes da API.
As credenciais das integrações são lidas de `apps/api/.env` com valores literais,
inclusive chaves que começam com `$`.

Para executar a API com configuração de produção local:

```powershell
docker compose --env-file .env.railway.local -f docker-compose.production.yml up -d --build api
```

Esse serviço fica disponível na rede interna do Compose. O arquivo privado
`.env.railway.local` contém os segredos gerados e configurações locais; está
ignorado pelo Git. A senha de banco e o segredo operacional desse arquivo são
exclusivos da validação local. Não importe esse arquivo inteiro para o Railway.

## Railway

Projeto `AACP-ZyonPayments`, ambiente `production`, serviço `api`, atrás do serviço `kong`.
O build usa `apps/api/Dockerfile` com contexto na raiz do monorepo.

- Start command: `node dist/main.js`
- Pre-deploy: `node scripts/predeploy-migrations.mjs`
- Healthcheck: `/ready`, timeout de 180 segundos
- API: https://api.zyon-payments.com.br
- Entrada pública: Kong, com encaminhamento privado para `api.railway.internal:3009`
- `TRUST_PROXY_HOPS=1`: a API reconhece o IP e o HTTPS encaminhados pelo Kong

A API não possui mais domínio público direto. O endereço Railway antigo foi
removido para que os acessos públicos passem pelo gateway. PostgreSQL e Redis
também usam a rede privada. Configuração, limites e deploy do gateway estão em
[infra/kong/README.md](infra/kong/README.md).

No PowerShell, use `railway.cmd` e `pnpm.cmd` caso a política de execução bloqueie
os arquivos `.ps1`. Após revisar os arquivos que serão publicados:

```powershell
railway.cmd up --project b8421237-6557-4677-a08c-c93453b08568 --environment 604c900d-afcd-4e98-b5b5-d3a1a428997c --service 2fcb2906-32f3-45df-a3ce-767064b49b98 --detach
```

O código de produção está na branch `master`, incluindo o trabalho de
`feat/checkout-journey-both-channels`. O serviço `api` está conectado à master
de `costaadiego1989/zyon`. O deploy por CLI de 05/09 usou o worktree isolado
`.audit/master-production-20260905`, preservando as alterações locais em andamento.
As cópias antigas em `.audit/railway-api-20260905` não devem ser reutilizadas.

O HTTPS de `api.zyon-payments.com.br` está validado. Além do CNAME fornecido
pelo Railway, o DNS na Vercel contém o TXT `_railway-verify.api` necessário
para comprovar a propriedade do domínio. Preserve os dois registros. Esse
domínio está associado ao serviço `kong`, na porta 8000.

## Banco e integrações

O banco Railway foi inicializado com o baseline em
`apps/api/prisma/deploy-migrations`. A atualização para master aplica
`20260905010000_master_schema_delta`, preservando os dados e o checksum do
baseline. O histórico antigo foi preservado. O pre-deploy reconcilia o registro
legado conhecido de checkout antes de executar `prisma migrate deploy`.
O PostgreSQL usa volume em `/var/lib/postgresql/data` e
`PGDATA=/var/lib/postgresql/data/pgdata`, evitando o diretório `lost+found`
existente na raiz do volume.
Para bancos que já contêm dados, siga `apps/api/prisma/DEPLOYMENT.md` antes de
adotar esse histórico. Não execute reset para resolver conflitos de migrations.

As URLs de retorno OAuth que apontavam para localhost ou ngrok foram ajustadas
para os domínios de produção nas variáveis do Railway. Esses mesmos endereços
precisam estar cadastrados nos painéis de cada provedor. A validação de deploy
verifica inicialização, banco, Redis e CORS; não realiza cobranças ou envios reais.
