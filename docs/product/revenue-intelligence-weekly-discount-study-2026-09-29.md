# Simulação de descontos no ciclo semanal

Entrega local de 29/09/2026, continuação de RI-11. O ciclo semanal pode anexar um estudo de desconto à proposta de comunicação que já aparece na notificação e na revisão do dashboard. Esta entrega não ativa incentivos.

## Comportamento implementado

- `GenerateHypothesisUseCase` prepara o estudo antes da chamada ao modelo, pelo contexto Prisma. O leitor e o simulador determinístico da entrega anterior avaliam 28 dias de entradas com janela de conversão de 168 horas encerrada, mínimo de 30 compradores e catálogo da própria loja.
- O resultado fica em `RevenueAnalysisRun.discountStudyJson`: candidato agregado ou ausência de candidato seguro. Não armazena carrinhos, compradores, variantes, cupons ou regras executáveis. Custo ausente impede a simulação daquele carrinho.
- Captura com leitura repetível e bloqueio do ciclo, proteção por loja, token e prazo da lease. Até duas retentativas adicionais tratam conflitos de serialização, incluindo o SQLSTATE 40001 retornado por consultas Prisma brutas. O prazo é revalidado pelo relógio do banco na gravação.
- O estudo integra o hash da versão revisada. A publicação exige correspondência exata com o documento gravado no ciclo. Revisões mantêm o mesmo estudo, período e validade; não refazem a consulta mesmo se o catálogo mudar. Um resultado sem candidato também é preservado até outro ciclo.
- A migração impede apagar ou reescrever o estudo depois da captura, inclusive trocar sua loja, ciclo, observação ou data de referência. Retentativas após falha do modelo reutilizam esse registro.
- O estudo não entra no prompt da LLM. A revisão e a confirmação deixam explícito que a aprovação inicia somente comunicação. A execução não recebe regra comercial; cupons, resgates e reservas permanecem sem alterações por essa aprovação.
- O dashboard mostra percentual, teto por carrinho, faixa avaliada, menor margem estimada, número de compradores, conversão observada e efeito “A medir”. A metodologia fica em detalhes expansíveis. Versões anteriores sem estudo não recebem números inventados.

## Configuração e migração

Aplicar `20260929030000_weekly_discount_study` antes do código que lê a nova coluna. A migração está espelhada em `prisma/migrations` e `prisma/deploy-migrations`; não há preenchimento retroativo.

`REVENUE_DISCOUNT_STUDY_ENABLED=false` é o padrão. A ativação exige também IDs explícitos em `REVENUE_DISCOUNT_STUDY_MERCHANT_IDS`, sem aceitação de `*`. As condições e limites existentes do ciclo semanal continuam aplicáveis. Desligar a flag interrompe novas capturas; estudos já gravados continuam disponíveis e não são descartados das versões seguintes.

## Evidência local

- 75 testes de domínio/aplicação passaram, incluindo 18 casos novos do contrato de estudo, simulação, leitura de coortes e governança da geração.
- 65 testes PostgreSQL da revisão passaram, incluindo oito novos cenários de estudo semanal: concorrência, isolamento, captura vazia, persistência imutável, falha do modelo, publicação, revisão e aprovação sem efeitos comerciais. O teste antigo que exige Redis real foi excluído por indisponibilidade local.
- Cinco testes PostgreSQL adicionais da execução passaram: ativação concorrente/idempotente, aprovação inválida, mudança de baseline, inserções sem autoridade e adulteração de vínculos.
- TypeScript da API e do dashboard passou. O cliente Prisma foi gerado somente em `.audit/revenue-weekly/client`, sem alterar dependências compartilhadas.
- Duas jornadas completas de navegador, em 1440 e 390 px, passaram com API controlada. Cobrem estudo disponível, ausência histórica, resultado sem candidato, formato futuro, detalhes, revisão, confirmação de comunicação e recuperação de envio. Capturas desktop/mobile foram inspecionadas.
- A migração foi aplicada nos dois bancos PostgreSQL 17 descartáveis usados pelas suítes. Repetir o predeploy no banco de revisão terminou sem migrações pendentes.
- A primeira execução concorrente revelou o SQLSTATE 40001 encapsulado como `P2010`, além de `P2034`. O tratamento foi corrigido; a regressão integral posterior passou. Total final: 145 testes, além das duas jornadas de navegador.

Logs locais: `.audit/revenue-weekly/weekly-discount-unit.log`, `weekly-discount-pg-final.log`, `weekly-discount-execution.log`, `weekly-discount-api-types.log`, `weekly-discount-dashboard-types.log`, `weekly-discount-browser.log`. Logs das migrações estão em `apps/api/.audit/revenue-weekly/weekly-discount-*-migration*.log` e `weekly-discount-migration.log`.

## Limites e continuação

A simulação usa preços/custos atuais no momento da captura e taxa de pagamento assumida de 4%. Não mede lucro líquido, aumento de conversão nem causalidade do perfil. Frete, impostos, devoluções e IA não entram nessa margem. A soma de descontos na amostra é hipotética: não constitui previsão, limite aprovado ou reserva financeira.

O próximo passo de RI-11 é criar a proposta executável de incentivo com público, prazo e orçamento comercial explícitos, decisão humana da versão exata, reserva concorrente, revalidação por oferta/pagamento e métricas de resgate. O estudo desta entrega é um insumo para esse caminho; o teste de comunicação não pode ser convertido em teste de desconto por alteração de prompt. Permanecem as demais fases do plano: economia integral, aprendizado validado entre lojas, outros canais e piloto operacional. Sem chamada a provedor real, ativação de flags, push ou implantação.
