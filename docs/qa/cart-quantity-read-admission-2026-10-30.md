# Admissão de quantidade antes da narração — 30/10/2026

O turno real `2b0560ae-168f-4cf1-a8fd-bb3addc39030`, no deployment `22e439bb-b6ef-4b7c-9104-9ccba7e05d55`, pediu20 unidades do Essencial e terminou com a resposta genérica de consulta não confirmada. Os logs do turno `0009970e-29c7-40b1-acc9-21e336d72b3c` mostram classificador, main, `get_cart/invalid_input`, novo main e rejeição de segurança, sem `update_cart_item`. Os argumentos originais não foram retidos. No replay somente de leitura, o provider incluiu `cartId`, mas ele não correspondia ao escopo canônico; esse replay não é o raw original.

A correção introduz `inspectCartQuantity` somente como capacidade interna dos handlers. Ela não entra na lista de ferramentas do modelo. Um comando direto de quantidade fornece referência e alvo; a leitura encontra o carrinho existente por merchant+session, resolve exatamente uma linha e consulta catálogo e estoque pelos mesmos leitores usados antes do update. Não usa `getOrCreate`, reavaliação de preços, TTL, reserva, evento ou escrita.

Uma quantidade negativa ou inválida recebe validação sem ler o carrinho. A fração mantém sua rejeição anterior à carga tardia de contexto. Quando o estoque não comporta o alvo, uma resposta fixa útil encerra o turno antes de main/retry/review. Linha ausente ou ambígua pede seleção; timeout, estoque não finito ou resposta fora de escopo não viram afirmação de estoque nem sucesso.

A admissão positiva carrega cartId, variantId, opções, slot e quantidade no contexto confiável. Isso não concede uma autorização adicional: somente o comando explícito atual continua autorizado pelo cart-turn-policy. O mesmo vínculo é conferido antes do writer. O alvo20 não pode virar2, nem o Essencial pode virar o físico deR$3. O writer mantém sua revalidação e a proteção de resultado desconhecido.

Zero continua sujeito ao contrato existente: a inspeção apenas admite a linha; uma remoção exige a execução normal de `update_cart_item(quantity=0)` autorizada pelo comando atual. Negação, condição e citação não recebem esse vínculo. O teste do agente preserva o item físico irmão.

Validação:168 testes focados e2 de OneBuyClick passaram, incluindo25 novas regressões. As duas execuções de teste repetidas anteriormente não são somadas a esse total. Não houve build local por falta de memória; a compilação remota da revisão final continua necessária.

Prova PostgreSQL real do reader candidato em memória: `production-stock-admission-reader-22-v2-proof.json`. O carrinho tinha6300 centavos e duas linhas;20 foi rejeitado,0 foi admitido com a variante do Essencial, estado antes/depois idêntico, zero escritas bloqueadas/realizadas e zero mensagens/model calls. O primeiro probe bloqueou equivocadamente uma consulta SELECT do agregador de avaliações; sua evidência foi preservada e não é contada como aprovação. O harness corrigido permite somente SELECT/WITH dentro de transação READ ONLY.

Prova do replay de provider: `production-stock-admission-baseline-provider-22-proof.json`. A validação real pelo WhatsApp após publicação continua pendente.
