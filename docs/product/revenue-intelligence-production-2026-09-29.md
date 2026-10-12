# Revenue Intelligence — publicação de 29/09/2026

O código do motor semanal, da revisão pelo merchant, dos incentivos protegidos por margem e da medição foi publicado em API, dashboard, storefront e widget. O rollout operacional está limitado à loja de testes Athom: agenda semanal e monitor determinístico ligados, geração paga e novas execuções comerciais desligadas.

## Revisão e evidências de produção

Revisão de código verificada: `b76f7ecedebf57befd6ede22ee00a4af68520c1b`. Verificação em 29/09/2026, aproximadamente 23:50 UTC (20:50 em São Paulo).

| Superfície | Deployment | Resultado |
| --- | --- | --- |
| API / Railway | `2f5b95e3-2695-4fd7-a3ad-51889eb01315` | `SUCCESS`; revisão confirmada dentro do runtime; `/ready` HTTP 200. |
| Dashboard / Vercel | `dpl_DaiLzQJs5dSPu6oVEEGZ7s4U2eoW` | `READY`, revisão correspondente e alias `app.zyon-payments.com.br`. |
| Storefront / Vercel | `dpl_Bwe74CZekgRK8F6XEJD8R5BEfWtL` | `READY`; página pública da Athom HTTP 200. |
| Widget / Vercel | `dpl_F1SeAayYgLKXRghmP3TAi9uruYzV` | `READY`, revisão correspondente e alias `widget.zyon-payments.com.br`. |

O dashboard público contém as rotas/ações de análise e revisão; o widget público contém o contrato de confirmação de preço. Entradas observadas: `assets/index-CUoV06RT.js` no dashboard e `assets/index-CsVQpyD3.js` no widget. A rota de análise retorna HTTP 401 sem autenticação, como esperado. A inspeção visual do cabeçalho usou API controlada, em 390 e 1440 px: componente `PageHeader`, fonte e tamanhos consistentes, foco inicial preservado e sem overflow.

As **66 migrations** esperadas pelo código constam aplicadas. Não há migration com falha sem resolução. A primeira tentativa (`25be06a`, deployment `d4883edb-4045-4931-b0ed-fd9d5d9d00bf`) encontrou tabelas de telemetria de IA já existentes e parou antes de substituir a API anterior. O reparo validou tipos, nulabilidade, defaults e índices; preservou as tabelas existentes, completou os objetos aditivos em transação e permitiu a reaplicação idempotente pelo Prisma. Não houve reset do banco ou remoção de dados. O registro anterior foi marcado como revertido; a reaplicação da foundation terminou em `2026-09-29T23:48:52.777Z`.

## Configuração efetiva e impacto

| Controle | Estado verificado no runtime |
| --- | --- |
| Loja elegível | Somente Athom na allowlist; plano efetivo `scale`, motor da loja habilitado. |
| Agenda | `REVENUE_WEEKLY_ENABLED=true`, fuso `America/Sao_Paulo`, grupo semanal 6. |
| Primeira análise | `2026-10-03T06:00:00Z`: **03/10/2026 às 03h em São Paulo**. Ciclo 0, sem análise concluída. |
| Teto de processamento | `REVENUE_ANALYSIS_DAILY_LIMIT=1`: no máximo uma nova análise iniciada por dia no sistema. Não é cobrança diária. |
| Geração semanal por LLM | `REVENUE_WEEKLY_GENERATION_ENABLED=false`; tetos financeiros diário/mensal/ciclo ainda não definidos. |
| Monitor | `REVENUE_STRATEGY_MONITOR_ENABLED=true`, lote máximo 100. |
| Filas | Análise semanal e monitor com jobs recorrentes registrados; zero jobs falhos na leitura realizada. |
| Aprovação, alternativas e execução | Flags de ativação não configuradas; permanecem desligadas por padrão. |
| Incentivos e aprendizado compartilhado | Flags de ativação não configuradas; permanecem desligadas por padrão. |

Na leitura, a Athom tinha zero ciclos executados, reservas de IA, estratégias, execuções de comunicação e execuções de incentivo do novo motor. Nenhuma estratégia foi aprovada para validar o deploy. Os jobs consultam a fila periodicamente; isso não significa uma nova análise nem uma chamada à LLM a cada consulta. A agenda é semanal por loja e o monitor coleta métricas deterministicamente.

O teto financeiro protege o consumo variável da API de IA; não cria cobrança fixa diária ou por merchant. Publicar o código não autoriza gastar um teto ainda não definido. A geração semanal desligada não desliga a IA de atendimento que já existia no sistema.

Para ativar recomendações e testes comerciais, configurar os tetos e a tarifa/provedor do gerador, conferir o contrato de checkout e habilitar os gates e allowlists documentados na [arquitetura](../architecture/revenue-intelligence.md#10-configuração-e-ativação). Incentivos também exigem política de margem e orçamento configurados pela loja, proposta elegível e aprovação específica do merchant. A ativação não deve criar vendas artificiais nem reduzir os critérios de medição. Com apenas uma loja, o mínimo de cinco operações independentes para aprendizado compartilhado não é atendido.

## Validação e limites da evidência

| Verificação | Resultado |
| --- | --- |
| [Verify master release — b76f7ec](https://github.com/costaadiego1989/zyon/actions/runs/36646795739) | Sucesso: tipos, builds e verificações exigidas por esse workflow. |
| API, integração completa — b76f7ec | 2.317 passaram, 11 falharam, 22 ignorados. As 11 falhas têm nomes e erros idênticos ao baseline `8b45e82`; as regressões identificadas nesta entrega passaram após o reparo. |
| Reparo de migration | 12/12 passaram: banco novo, repetição, fixture com 39 colunas e nove índices preexistentes, preservação de dados/OIDs e recusa de incompatibilidades. |
| Motor, rodada focada | 212 passaram, um ignorado; política semanal adicional 1/1; execução/pagamento focado 10/10. |
| Clientes, rodada focada | Dashboard 43/43; widget/Pulse 32/32; builds de dashboard, storefront e widget concluídos. |
| Playwright, recuperação de checkout | 24/24 casos novos passaram localmente com a dependência workspace compilada, sem retries, alterações de assertivas ou timeouts. |
| Integração após reparo | Tenant/recibos/baseline/aprendizado 37/37; frete/segurança 12/12; margem 1/1; chat e UCP no mesmo processo 27 passaram e um skip anterior; boundary passou. |

As falhas anteriores da API envolvem fixtures de billing, refunds, OTP/cadastro, prefixo do agente, quick replies e JWT do TestSeed. O [run completo](https://github.com/costaadiego1989/zyon/actions/runs/36646795602) não deve ser apresentado como verde. A rodada ampliada local de execução foi interrompida depois dos casos alvo e não equivale a uma suíte completa aprovada.

O E2E de browser do widget em `25be06a` e no baseline anterior ficou bloqueado pela mesma preparação ausente de `@zyon/shared-types`, seguida de timeouts; ambos os jobs foram cancelados. O workflow agora compila essa dependência antes do Playwright. Os 24 casos novos passaram localmente após essa preparação; esse resultado não equivale à aprovação de toda a suíte de browser no CI.

Ainda não há evidência de um ciclo semanal real concluído, entrega de uma recomendação gerada, execução comercial aprovada, aumento de conversão/lucro ou aprendizado entre lojas. Esses resultados dependem da ativação controlada e de dados reais com maturidade suficiente.

Evidências técnicas locais da publicação ficam em `.audit/production-release-after.json`, `.audit/production-athom-audit.json`, `.audit/public-release-http.json`, `.audit/public-artifact-verification.json`, `.audit/foundation-repair-tests.log` e nos logs de testes; são artefatos locais ignorados pelo Git. Este relatório preserva os resultados necessários à revisão sem incluir credenciais ou dados de compradores.
