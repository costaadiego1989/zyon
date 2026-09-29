**Quinta entrega local — contrato do chat usado nas propostas**

24/09/2026. Continuação de `4895dd4`, na branch `feat/revenue-intelligence-weekly`. Avança a dependência de controle de RI-06/07/09. Ainda não conclui aprovação, ativação ou a jornada do cliente.

**Problema resolvido.** O adaptador do Revenue Manager não conseguia fornecer o comportamento atual do checkout. Um texto escrito pela LLM ou copiado de um experimento antigo não reproduziria a composição real. Agora há um contrato de escopo explícito: `checkout-chat-baseline-v1`, somente para os turnos atendidos pelo gateway principal de LLM (`primary_llm_turn_only`).

O gateway do checkout e a captura da proposta usam o mesmo programa de composição, as mesmas definições de ferramentas e a mesma seleção de provedores. A extração preserva as mensagens existentes. O contrato inclui nome da loja, regras consultivas normais e após falha de pagamento, programa de composição, ferramentas, parâmetros de geração, identificação do modelo, hash do endpoint, revisão do código e hashes das configurações. Credenciais não entram no contrato. Carrinho, etapa e intenção consentida são dados do turno; não são congelados como dados de um comprador na proposta da loja.

O controle usa uma referência opaca ao hash do contrato. Essa referência não é um prompt para o comprador. A proposta de tratamento é um complemento de comunicação limitado a 4.000 caracteres. O construtor do controle reproduz o texto original com os dados dinâmicos do turno; a aplicação do complemento ao checkout depende do futuro caminho de execução aprovado.

**Geração e revisão.** O adaptador real lê configurações persistidas da loja em uma transação com snapshot consistente. Não cria valores padrão. Falta de configuração, revisão de código, provedor fixado ou política válida mantém a geração indisponível antes de chamar a LLM. A geração com esse contrato exige contexto do ciclo semanal, mantendo as reservas financeiras existentes.

O artefato é salvo dentro da versão imutável da estratégia. Antes de publicar, o servidor compara novamente o contrato sob locks das linhas de loja, política e configurações do checkout. Mudanças durante a geração ou entre a verificação inicial e a gravação impedem publicar a proposta. A transação desfaz também a hipótese e a notificação quando a publicação falha. Revisões preservam contrato, evidência e validade originais; uma configuração diferente exige outra análise.

O checkpoint da resposta da IA passa a vincular referência do controle e hash do contexto: contrato, observação, restrições e pedido de revisão. Retry do mesmo contexto reutiliza o resultado; mudança no contexto não pode reaproveitar e relabelar a resposta antiga. Cada chamada nova continua passando pela reserva de custo. O caminho legado permanece compatível com seus checkpoints anteriores.

**Limites explícitos.** `baselineStatus=primary_chat_contract_captured` significa que o artefato do chat foi capturado. Não significa que o checkout completo possa executar um experimento. `execution=unavailable`, `approval_available=false` e `activation_available=false` continuam vigentes. O adaptador legado de experimentos recusa referências desse contrato, impedindo tratá-las como instruções de sistema.

O contrato não representa os fluxos determinísticos de cadastro/OTP, a conversa de fallback, negociação econômica, mudanças de carrinho, pagamento ou frete. Essas rotas não podem ser declaradas exposições ao experimento de comunicação sem o contrato de atribuição correspondente. Também não corrige ou reinterpreta os valores monetários formatados pelo checkout existente. O hash de revisão do código precisa corresponder ao artefato realmente implantado; é uma configuração obrigatória de release, não prova automática de identidade entre instâncias.

Antes de ativar, ainda é necessário apresentar ao cliente uma nova versão completa contendo plano de medição, público elegível, controle/tratamento executáveis e validade; implementar aprovação e publicação transacionais, registro de atribuição/exposição, encerramento, pausa e a jornada do dashboard. Não há implementação de cupom inteligente, execução monetária nova ou aprendizado compartilhado nesta entrega.

**Configuração.**

| Configuração | Regra |
| --- | --- |
| `REVENUE_CHECKOUT_CONTRACT_ENABLED` | `false` por padrão |
| `CHECKOUT_BEHAVIOR_REVISION` | Hash imutável do build do checkout, 40–64 caracteres hexadecimais minúsculos; sem valor padrão |
| `CHECKOUT_LLM_PROVIDER` | Provedor explícito com uma rota configurada; a captura não assume uma cadeia variável de fallback |
| Política e checkout settings | Registros existentes por loja; engine habilitado |
| Agenda, revisão e orçamento | Continuam exigindo as flags, elegibilidade, lojas permitidas e limites das entregas anteriores |

Não preencher revisão fictícia ou credenciais de exemplo em uma implantação. Os testes usam configuração sintética isolada. Esta entrega usa as colunas JSON e triggers imutáveis anteriores; não adiciona migration. Não houve push, merge, implantação, chamada paga de IA ou ação comercial.

**Validação local.** Evidências em `apps/api/.audit/revenue-weekly/`:

- `capture-checkout-golden.mjs`: captura executada do gateway de `4895dd4`. A comparação verifica igualdade das mensagens em 40 combinações de etapa, nome de loja, regras e intenção, além das ferramentas.
- `baseline-regression-final.log`: 405 testes de Revenue Manager, experimentos e os fluxos afetados de checkout; 396 passaram, oito falharam e um foi ignorado. As oito falhas de cadastro/OTP foram reproduzidas usando as fontes anteriores de `4895dd4`, com os mesmos nomes e sem nova falha (`baseline-prior-checkout.log`, `baseline-failure-comparison.json`). A suíte ampliada não está inteiramente verde.
- `baseline-integration-final.log`: 26 testes aprovados, sem falha ou skip, com PostgreSQL real, fila Redis da fixture e transporte de IA simulado. Oito cenários novos incluem captura pelo adaptador real, publicação, revisão, mudanças de configuração, concorrência com alterações de loja/política/settings, reserva financeira e checkpoint; os 18 cenários anteriores de estratégias também passaram.
- `baseline-typecheck-final.log`: TypeScript da API aprovado com o cliente Prisma isolado das entregas anteriores.

Fixture dedicada: PostgreSQL local porta 5557, banco `revenue_strategy_0924`; Redis local porta 6397, banco 15 e fila `revenue-weekly-analysis`. Os containers dedicados foram parados após a validação. Não houve teste no navegador, chamada a provedor real, ativação de experimento ou medição de ganho comercial. Evidências anteriores continuam nos relatórios de cada entrega.
