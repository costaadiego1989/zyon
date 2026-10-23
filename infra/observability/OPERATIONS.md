# Operação local de observabilidade storefront

Estado do repositório em 17/10/2026. Este runbook e as regras são preparação
local: não houve deploy, ativação de coleta real, incidente de produção comprovado
ou entrega de notificação. Não usar este Compose como configuração de produção.

## Regras e sinais existentes

Prometheus carrega `prometheus/rules/storefront-local.yml` pela configuração local
e pelo mount read-only do Compose. Nenhum serviço foi iniciado por essa mudança.
Não há Alertmanager, receiver, Slack, e-mail ou roteamento de plantão configurado.
`pending`/`firing` no Prometheus não significam que alguém recebeu um aviso.

| Alerta | Critério local provisório | Significado e resposta |
| --- | --- | --- |
| StorefrontContractOutputInvalid | Aumento de decisões invalid_context/invalid_output/safety_rejected em 5 min, sustentado 1 min | Investigar rejeição/fallback de contrato. Não afirmar resposta inválida entregue nem autorização comercial indevida. Conferir estágio e correlação técnica gerenciada. Input inválido e recusa comercial normal não entram. |
| StorefrontCartOutcomeUnknown | Aumento tool/unknown/cart_outcome_unknown em 5 min, sem espera adicional | Resultado de escrita não confirmado; não repetir a mutação automaticamente. Conferir carrinho/evidência persistida pelo fluxo autorizado e escalar investigação. Contagem de decisões não é contagem de cobranças/pedidos. |
| StorefrontTurnErrorRate | >10% de operações turn com erro, >=20 turnos estimados em 5 min, por 2 min | Turno lançou exceção. Provider/persistência podem falhar e terminar em fallback válido; não usar soma dos estágios aninhados como número de requisições. Não comprova rollback. |
| StorefrontSlowTurns | >20% de observações turn acima do bucket existente 10s, >=20 observações estimadas em 5 min, por 5 min | Latência de turnos concluídos, inclusive erros. Não é timeout, SLO, P95 exato ou detecção de operação travada ainda sem observação final. Investigar provider, persistência e pressão operacional. |
| StorefrontMetricsScrapeUnavailable | Algum target do grupo com up=0 por 2 min | Falha de scrape: endpoint, autorização, target ou rede. Não prova API comercial indisponível. Abrir Targets para identificar instância; instance não é label do alerta. |

Somente `job`, `service` e `environment` já configurados no scrape ficam na
agregação. `severity`, `scope=storefront` e `evaluation=local` são constantes.
Sem merchant/buyer/session/cart/model/prompt/trace/exception como labels. Réplicas
são agregadas; ambiente e serviço não se misturam. Anotações são estáticas, sem
conteúdo de cliente, stack ou payload de ferramenta.

Os valores acima não foram calibrados com tráfego real. Não alteram regras
financeiras, quotas, ofertas, preços ou runtime da aplicação. Antes de uso real,
aprovar severidades, limiares, responsável, horários e orçamento de ruído.

## Triagem e estado sem dados

1. Confirmar em Rules/Alerts que `storefront-local` foi carregado e que a avaliação
   não tem erro. As regras são avaliadas a cada 15s no arquivo operacional local.
2. Confirmar Targets e `up{job="aacp-api"}`. O target versionado continua
   `host.docker.internal:3001`; conferir porta real da API, sem alterar destino
   silenciosamente. A configuração não descobre serviços de produção.
3. Se scrape está OK mas não há séries, conferir autorização operacional para
   `STOREFRONT_LLM_OBSERVABILITY=enabled` e presença de turnos observados. A flag
   continua desligada por padrão; este trabalho não a habilita. `up=1` comprova
   scrape, não que toda instrumentação esteja ativa.
4. Estado **sem dados**, coleta desligada, série removida, volume baixo e ausência
   de tráfego não são saúde comprovada. Não há alerta de ausência de turnos: sem
   calendário/baseline e opt-in, isso geraria falsos alarmes. Nenhum alerta dispara
   para um target removido por completo da configuração; auditar inventário.
5. `increase()` usa amostras, corrige resets e extrapola a janela: >=20 é estimativa,
   não livro contábil. Uma série que nasce já em 1, eventos entre scrapes, perda de
   scrape ou reset podem esconder o primeiro evento. Esses alertas não substituem
   reconciliação/auditoria de pagamentos ou disponibilidade end-to-end.
6. Usar painel `storefront-llm`, logs gerenciados e traceId/spanId técnicos quando
   existirem. Trace não amostrado/exportado pode não estar disponível. Não coletar
   prompt/histórico/token/código de cupom/corpo para explicar o alerta.
7. Resultado incerto: não repetir escrita por dashboard/alerta. Investigar pelo
   fluxo autorizado; qualquer intervenção financeira requer autoridade específica.

## Retenção atual verificada nos arquivos, não no ambiente publicado

| Componente | Configuração atual | Limite da evidência |
| --- | --- | --- |
| Prometheus 3.4.0 | `--storage.tsdb.retention.time=7d`, volume `prometheus-data` | Não há limite de tamanho explicitado. Janela temporal não é garantia de disponibilidade de disco nem [remoção instantânea](https://prometheus.io/docs/prometheus/latest/storage/). Não inspecionamos TSDB/flags de instância ativa. |
| Loki 3.4.3 | Filesystem, volume `loki-data`; sem compactor.retention_enabled nem retention_period configurados | Não há política explícita habilitada de expurgo de logs neste arquivo. A [documentação oficial](https://grafana.com/docs/loki/latest/operations/storage/retention/) indica retenção desabilitada por padrão. Não presumir 7d nem apagar volume para cumprir política. |
| Tempo 2.7.2 | Backend local, WAL e volume `tempo-data`; sem block_retention explícito | `query_frontend.search.max_duration=720h` limita consulta, não define retenção/expurgo. Defaults dependem da versão efetiva; retenção operacional não homologada. |
| Grafana 11.6 | Volume `grafana-data`, sem política de expurgo/backup configurada | Dados de configuração, usuários e dashboards não herdam 7d do Prometheus. Credenciais iniciais podem divergir se o volume já existia. |
| Alloy 1.20.1 | Perfil opt-in logs, volume `alloy-data`, storage.path próprio | Estado/checkpoints locais não equivalem retenção do Loki. Sem política de limpeza/backup explícita neste Compose. |

Não alteramos retenção, compactor, volume, arquivos antigos ou dados existentes.
Escolher duração/tamanho, exclusão/backup/restauração, acesso e política de dados
reais exige decisão operacional e autorização separadas. Configurar expurgo pode
ser destrutivo; planejamento e homologação precisam preceder essa mudança.

## Acesso atual e pendências de segurança

- Grafana: bind host 127.0.0.1:3100, usuário/senha inicial de demonstração
  `admin/admin`, anonymous desabilitado. Não é configuração de produção nem prova
  das credenciais de volume existente. Nenhum login/senha foi solicitado ou alterado.
- Prometheus 9090, Loki 3101, Tempo 3200 e OTLP 4318 têm bind host loopback. Isso reduz
  exposição pelo host; não autentica processos locais, participantes da rede Docker
  ou clientes OTLP. Loki usa `auth_enabled:false`; não há TLS/auth explícito no
  servidor Prometheus/Tempo deste Compose. Host local comprometido continua risco.
- `/metrics` da API em produção requer `OPS_SHARED_SECRET` e Bearer ou X-Ops-Secret.
  Configuração versionada local só contém exemplo comentado de credentials_file;
  não contém segredo nem mount. Produção exige HTTPS/rede privada e arquivo de
  segredo com escopo/rotação, sem token em comando, chat, query ou versionamento.
- Receiver remote-write do Prometheus já está habilitado no Compose; não foi
  ativado nesta tarefa. Revisar restrição/autenticação antes de dados reais.
- Alloy permanece fora do comando padrão; socket Docker read-only não torna sua
  API segura/somente leitura. Não ligar coleta genérica ou receber produtores
  desconhecidos como se fossem dados confiáveis.
- Acesso real exige SSO/RBAC/contas individuais, segregação de ambientes, TLS,
  credenciais distintas, rede/reverse proxy, auditoria e responsáveis definidos.
  Este trabalho não aplica esses controles nem habilita serviço externo.

## Testes sem stack ou destinos reais

Na raiz do clone:

```powershell
node --test infra/observability/tests/alerts.contract.spec.mjs
node infra/observability/tests/validate-alerts.mjs
```

O primeiro comando usa somente arquivos e parser YAML já instalado no workspace.
O segundo requer Docker Linux e a imagem `prom/prometheus:v3.4.0` já em cache;
não faz pull. Registra image ID e executa por ID imutável. Usa containers sequenciais
`--rm --network none --read-only`, mounts read-only, /tmp tmpfs 64MB, memória 256MB,
1 CPU, capabilities removidas, sem portas/segredos/volume persistente/daemon change.
Promtool recebe séries sintéticas por stdin, cria TSDB só no tmpfs e termina.
Não inicia API, Prometheus servidor, Compose, Grafana, DB, Redis ou LLM.

Fixtures exercitam pending/firing/resolução, contador resetado, isolamento de
ambiente/job, réplicas, volume baixo, operações aninhadas, tráfego saudável/ocioso
e ausência de séries. Guardas conferem métricas reais, labels e integração de
arquivo/mount. Isso não comprova ingestão real, entrega, ações de plantão,
calibração de limiar, expurgo ou recuperação de dados em produção.

Evidência local deste ciclo: guardas primeiro em RED (1 aprovado/4 falhas),
promtool também RED por regras ausentes após fornecer tmpfs; final com 6/6 guardas,
14 grupos/55 expectativas promtool e config com 5 regras válidas. Imagem em cache
validada e usada pelo ID
`sha256:78ed1f9050eb9eaf766af6e580230b1c4965728650e332cd1ee918c0c4699775`.
Regressão dos artefatos e fixtures anteriores: 28/28 aprovados. Nenhum container
de validação permaneceu após as execuções. Não somar esses resultados à suíte
API registrada como se fossem testes novos sem sobreposição.

## Critérios antes de homologação externa

- Aprovar instrumentação e destino por ambiente; inventariar todas as superfícies
  e canais de dados, custos, volume e acesso. Não confundir LangGraph com backend
  de observabilidade ou LangSmith/OTel com autorização para coletar dados.
- Homologar scrape autenticado e séries reais sem PII; testar coleta desligada,
  perda de target e ruído dos limiares em período representativo.
- Definir Alertmanager/receiver, escalonamento, janela e responsável. Exige
  autorização para integração e teste de entrega controlado; não foi feito aqui.
- Definir/aprovar retenção por componente; homologar configuração efetiva da
  versão, backup/restauração e expurgo com dados sintéticos antes de dados reais.
- Conferir acesso/TLS/rede e volumes existentes; não reutilizar demo admin/admin.

Referências oficiais consultadas para semântica e validação:
[regras de alerta](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/),
[testes promtool](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/),
[armazenamento Prometheus](https://prometheus.io/docs/prometheus/latest/storage/),
[retenção Loki](https://grafana.com/docs/loki/latest/operations/storage/retention/),
[configuração Tempo](https://grafana.com/docs/tempo/latest/configuration/).
Defaults da documentação latest não certificam a versão 2.7.2/instância ativa.
