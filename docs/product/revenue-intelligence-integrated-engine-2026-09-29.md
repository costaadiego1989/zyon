# Motor integrado: incentivo, alternativa e aprendizado

O fluxo local conecta a recomendação financeira semanal à decisão do lojista, ao desconto no checkout e à medição por estratégia. A IA prepara a proposta; o lojista pode aprovar, recusar ou pedir outra sugestão. Valores comerciais continuam sujeitos às regras determinísticas da loja.

## Comportamento entregue

- A aprovação específica, com execução habilitada para a loja, registra atomicamente o orçamento e o teste de sete dias. Sem esse gate, registra somente a decisão e a interface explica que o teste não começou.
- Compradores elegíveis são atribuídos de forma estável a controle ou tratamento. O grupo de controle permanece no checkout sem o benefício experimental; compradores que não compram continuam no denominador.
- O desconto percentual tem teto em centavos, orçamento total, limite de usos e um uso por comprador. Catálogo, custos, identidade, consentimento, público, carrinho, margem e ausência de outros incentivos são conferidos na concessão e novamente antes do pagamento.
- A reserva do desconto e a alteração do checkout são atômicas. Evidências imutáveis dos pagamentos conciliam o consumo. Devoluções não reabrem o orçamento consumido.
- Cancelar impede novas ofertas e preserva conciliação de pagamentos em andamento. Se o benefício expirar antes de criar o pagamento, o checkout mostra o total atualizado e exige nova confirmação explícita, vinculada ao carrinho, ao total e à taxa. Não há nova cobrança automática com preço maior.
- A alternativa financeira reaproveita a revisão assíncrona e o orçamento de IA do ciclo. O motor reduz desconto e orçamento, preserva público e plano de teste, e a LLM adapta a explicação. A preferência do usuário não define valores financeiros. A alternativa requer nova aprovação.
- Comunicação e incentivo não executam testes simultâneos na mesma loja. Uma estratégia com orçamento de incentivo registrado não aceita mudanças pela decisão de comunicação; resultados e cancelamento específico continuam acessíveis.
- O dashboard distingue decisão, agendamento, execução, suspensão e encerramento; mostra participantes, conversão, receita observada, descontos, reservas, consumo e devoluções. A decisão atualiza os dados imediatamente. O monitor gera uma notificação de resultado sem nova chamada de IA.

Sete dias encerram a admissão de compradores. A janela de conversão individual pode exigir mais sete dias para completar a medição. Falta de amostra permanece inconclusiva, e nenhum resultado promove outra estratégia automaticamente. Receita e desconto não são apresentados como lucro ou ganho incremental comprovado.

## Aprendizado entre lojas

O gerador semanal pode receber padrões fixos de comunicação derivados de experimentos maduros e verificáveis. Exige participação explícita e pelo menos cinco lojas de grupos proprietários independentes, contexto compatível e evidência íntegra. Inclui resultados negativos e inconclusivos e descarta fontes inválidas ou incompletas.

Não compartilha identificação de lojas, compradores, textos livres, prompts ou números individuais. O contexto agregado fica congelado no ciclo e vinculado ao cache da geração. Revisões reutilizam esse contexto; não há uma chamada de LLM adicional para compartilhamento. O padrão é uma hipótese para teste local, nunca autorização comercial ou promessa de resultado.

## Migração e ativação

Migrações aditivas espelhadas em `prisma/migrations` e `prisma/deploy-migrations`:

1. `20260929100000_incentive_execution`: execução, atribuição e evidência de pagamento imutáveis.
2. `20260929110000_incentive_alternatives`: validação dos termos alternativos preservando contratos anteriores.
3. `20260929120000_validated_shared_learning`: contexto compartilhado imutável por análise.

Execução requer `REVENUE_INCENTIVE_EXECUTION_ENABLED`, allowlist de lojas e os gates existentes de revisão/orçamento. Compartilhamento requer `REVENUE_SHARED_LEARNING_ENABLED`, allowlist explícita e mínimo independente de cinco lojas. Flags novas permanecem desativadas por padrão. A geração semanal e suas cotas financeiras continuam com a configuração já implementada.

Os dois bancos PostgreSQL descartáveis receberam as 62 migrações. O cliente Prisma foi gerado isoladamente; dependências compartilhadas não foram alteradas. Não houve implantação, chamada a provedor real ou envio externo.

## Validação local

Passaram os testes de domínio, contratos, transporte e PostgreSQL: 104 verificações base de incentivo/medição/controllers; 13 de domínio/controller de alternativa; 21 de aprendizado compartilhado; 11 de alternativa integrada (incluindo supressão de nova geração paga durante incentivo ativo); cinco de métricas do incentivo; 11 de execução comercial; 44 de criação de pagamento/webhooks; 20 de dashboard; 16 dos dois widgets.

A regressão de orçamento e revisão cobriu 149 casos distintos. Um caso inicialmente falhou porque a fixture previa início em apenas 700 ms; passou na repetição após ampliar a antecedência para dois segundos. A ativação real relê o relógio após as verificações preliminares e agenda o início com cinco segundos de antecedência, preservando os hashes e o rollback integral. O caso de fila Redis não foi executado nesta rodada.

Outros 56 testes PostgreSQL passaram para compatibilidade de cupons, versão da sessão, monitoramento, atribuição, custos e continuidade de pagamento. Total: 450 testes distintos aprovados, contando a repetição corrigida uma única vez. As jornadas de navegador são evidência adicional e não entram nessa contagem.

TypeScript passou para API, dashboard e widget_v2; Prisma validou o schema. As migrações espelhadas têm hashes idênticos. Dashboard e componente real de confirmação do widget passaram no navegador em 1440 e 390 px, com HTTP controlado; a confirmação inclui teste por teclado. O Pulse foi validado com testes de transporte e estado, sem alegar navegador completo para essa superfície.

Logs principais: `.audit/revenue-weekly/parallel-close-*`, `incentive-alternatives-integration.log` e `incentive-metrics-integration.log`. Capturas: `parallel-close-ui/` e `checkout-price-review-{390,1440}.png`. As três frentes foram implementadas em paralelo e integradas no mesmo checkout local.

## Limites da entrega

O runtime implementado é desconto percentual limitado no checkout, sem código de cupom público e sem empilhamento. Carrinhos com opções não precificadas, itens de outras lojas, frete subsidiado ou custos desconhecidos não recebem o benefício. A biblioteca compartilhada usa padrões de comunicação; não replica descontos de outras lojas.

Comunicação externa em novos canais, frete subsidiado, apuração econômica integral e comprovação comercial em piloto continuam fora deste fechamento local. A liberação operacional precisa aplicar as migrações, configurar limites/lojas e observar pagamentos e experimentos reais até a maturidade. Testes controlados não comprovam aumento de receita do cliente.
