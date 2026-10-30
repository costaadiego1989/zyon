# Consulta de produtos com desconto — 30/10/2026

Capacidade de leitura adicionada a partir de `7a31a8c`; não altera classificação de intenção, pedidos, pagamentos, estoque ou o menu `getDailyDeals`.

- `discountOnly=true` exige promoção automática ativa, aplicada e autorizada no preço canônico da mesma variante. A variante precisa atender a preço, estoque, avaliação, atributos obrigatórios e exclusões. Cupom isolado, promoção expirada/inativa, capacidade interna de conceder desconto e benefício futuro não comprovam uma oferta.
- O preço efetivo precisa ser menor que a base confirmada e ter badge canônico sem cupom, com promoção identificada. O carousel conserva preço efetivo, original e percentual coerentes; não inventa ranking.
- Agente, ferramenta nativa e executor UI usam o mesmo dispatcher. Sem autoridade de preço, não retornam à busca por preço base. O handler candidato bruto recusa o filtro; internamente o reader remove somente a flag antes de buscar candidatos e reaplica o critério após a cotação.
- Turnos que não admitem descoberta de produtos não expõem a porta `recommendProducts` ao modelo principal. Um plano monetário ou de desconto inventado num lookup auxiliar não ativa uma busca comercial; o lookup normal sem critérios continua disponível.
- Categoria e cursor são preservados e validados. Uma leitura iniciada por cursor é parcial e não comprova ausência global nem autoriza ampliar a família. O transporte público continua rejeitando `criteria` do cliente.
- O planner só pode emitir `true` ou `null`. Um `false` reemitido pelo provider invalida o plano antes de qualquer consulta. No contrato interno antigo, `false` continua significando ausência do filtro; não significa “somente sem desconto”. O filtro inverso e a ordenação por maior desconto permanecem não suportados.

## Verificação

O baseline local tinha 15 testes aprovados e 12 falhas para a capacidade nova. Após a implementação, o gate final aprovou **66/66** casos, incluindo provider double → agente → dispatcher → contrato, UI, fronteira pública, preço canônico, teto R$70, cupons, vigência, estoque, atributos e erro de autoridade. Dois testes antigos que esperavam busca monetária por preço base foram atualizados para o caminho canônico e passaram no reteste.

A integração também reproduziu um desvio da porta canônica num turno sem descoberta. Após a proteção mínima do Proxy, o gate adicional de lookup e dispatcher aprovou **16/16** casos; o cenário novo falhava antes da correção. A revisão independente aprovou os controles de preço e fronteiras antes da entrega.

Evidências em `.audit/whatsapp-final-acceptance-20261028/`:

- `local-discount-only-baseline.log`
- `local-discount-only-final-gate.log`
- `local-discount-only-legacy-fixtures.log`
- `local-discount-only-lookup-port-baseline.log`
- `local-discount-only-lookup-port-final.log`
- `production-discount-only-candidate-1747.json`

Às **20:10:48 UTC**, com provider e catálogo reais do deployment `1747e1c8-503e-4847-bad8-fedfaac10d76`, o candidato carregado apenas em memória produziu:

| Consulta | Resultado |
| --- | --- |
| Texto persistido de QR18: “Quais produtos estão com desconto?” | `discountOnly=true`; somente Completo, R$90, original R$100, 10%; mesma variante R$90; schema válido |
| Produtos com desconto até R$70 | Sem produtos; teto preservado |
| Ordenar pelo maior desconto | Não suportado; nenhuma leitura de catálogo |
| Somente produtos sem desconto | Não suportado; nenhuma leitura de catálogo |

A operação usou transação `READ ONLY`, sem persistência de conversa, mensagens externas ou mutações. É uma reextração do texto persistido, não reprodução de argumentos originais do planner. A reextração baseline também variou; não é atribuída uma classificação histórica não registrada. As promoções representam o instante da prova e precisam ser revalidadas no reteste publicado.

Este relatório não declara deploy ou aceite final em WhatsApp. A extração por linguagem natural continua sujeita ao contrato; não há promessa de filtro inverso, ordenação por maior desconto ou cobertura universal de linguagem.
