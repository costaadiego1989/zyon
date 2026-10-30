# Recuperação de venda sem correspondência exata — runtime

Implementação local de 30/10/2026, a partir de `a67f9bb` e da correção de quantidade zero `44e9e35`. Este relatório não declara publicação nem envio de mensagens.

## Comportamento

- O plano aceita uma proposta de leitura `recovery`, com família e termos opcionais de nome/modelo. O runtime verifica a relação entre consultas; não aceita trocar a finalidade, remover exclusões, compatibilidade ou valores obrigatórios. Um nome separado da consulta só pode estreitar a primeira leitura quando aparece literalmente na mensagem atual.
- Preferências positivas já tipadas ativam exato → semelhante na mesma consulta mesmo se o provider não preencher `recovery`. A primeira fase exige também essas preferências na variante; apenas zero confirmado e completo permite a segunda fase. Todo `required` e `not_equals` continua obrigatório.
- Modelo/marca exclusivos e obrigatoriedade antes ou depois do valor impedem relaxamento. Negar uma obrigação não equivale a impô-la: “azul não é obrigatório” continua preferível; “azul não é opcional” é obrigatório.
- A recuperação conserva o núcleo lexical inicial do produto, inclusive quando o nome exato foi acrescentado separadamente. Não permite remover a família e deixar somente um nome que coincida com outro produto. No caminho de nome separado, exige ao menos dois grupos positivos na família; um grupo único ambíguo pede esclarecimento sem cartões. Preferências na mesma consulta continuam disponíveis para uma família de uma palavra. Este é um recorte inicial conservador, sem pretensão de classificar toda finalidade por linguagem natural.
- As duas fases compartilham até três páginas de catálogo e sessenta cotações individuais. Limite, paginação cíclica, erro ou preço desconhecido não comprovam ausência global. Nenhuma recuperação reexecuta escrita.
- Cada variante elegível passa pela mesma autoridade de preços e promoções do checkout, inclusive quando não há faixa monetária. Os limites monetários são aplicados depois da cotação, sem inventar descontos. A mesma variante precisa comprovar atributos e estoque.
- A resposta apresenta até três alternativas como semelhantes, com diferenças públicas e convite para detalhes ou comparação. Se não houver alternativa elegível, pergunta sobre uma condição específica antes de qualquer flexibilização.
- `appliedPlan` conserva exatamente o plano original. `matchType` e `differences` são evidência pública, sem custos internos ou autoridade para adicionar, cobrar, alterar estoque ou criar pedido.

## Evidência local

- O teste inicial da recuperação registrou 12 falhas em 15 casos antes da implementação.
- O conjunto ampliado terminou com 165/166 casos aprovados. A única falha, `long conversations classify only the latest six turns while preserving the main agent's latest ten`, foi reproduzida na base `44e9e35`: a expectativa antiga não considera a mensagem atual adicional. Não foi alterada neste escopo.
- A revisão independente apontou obrigatoriedade depois do valor e sua negação, além de duas formas de remover indevidamente a família (inclusive nome acrescentado separadamente). Os 42 testes focados passaram após as correções. Incluem o reader real, o agente, o contrato de saída e a UI do WhatsApp.
- A comparação de `tsc --noEmit` com a base produziu as mesmas 22 linhas de diagnósticos herdados, sem diferença e sem diagnóstico nos arquivos alterados. Não equivale a um build de publicação.

Arquivos de auditoria em `.audit/whatsapp-final-acceptance-20261028/`:

- `local-shopping-recovery-baseline.log`
- `local-shopping-recovery-release-gate.log`
- `local-shopping-recovery-baseline-scope.log`
- `local-shopping-recovery-obligation-final.log`
- `local-shopping-recovery-family-appended-fixed.log`
- `local-shopping-recovery-final-safety-gate.log`
- `local-shopping-recovery-typecheck.log`
- `local-shopping-recovery-baseline-typecheck.log`

## Provider e catálogo reais, somente leitura

Às **19:19:50 UTC de 30/10**, no deployment `70cad8b1-33a4-48a1-b7e5-508d386b065d`, o candidato final foi carregado apenas em memória. Foram usados os prompts atuais do trabalho principal com o novo contrato de leitura e uma transação `READ ONLY`, sem persistência de conversa ou mensagens externas.

| Caso | Resultado verificado |
| --- | --- |
| SALE21, nome ausente, azul preferido, teto R$70 | Essential R$60, `similar`, diferença preto/azul e próximo passo; duas leituras |
| Correção de teto para R$95 | Essential R$60 e Completo R$90 com promoção canônica, diferenças e próximo passo; duas leituras |
| Azul obrigatório, teto R$70 | Sem cartões; pergunta antes de flexibilizar a cor |
| Teto absoluto R$50 | Sem cartões; pergunta específica preservando o teto |

Todos os resultados passaram pelo schema de saída da ferramenta. O teste local adicional comprova a projeção Agent → contrato de storefront → UI de WhatsApp. O provider real continua decidindo como extrair nomes e famílias; esta evidência não afirma cobertura universal de linguagem natural nem GraphRAG/Cypher implementado.

Evidência: `production-shopping-recovery-candidate-70cad8.json`, com hashes dos arquivos efetivamente carregados, plano, leituras, produtos públicos, preços e resultado do schema. As promoções são as vigentes naquele instante; não presumir a mesma condição em outro horário.
