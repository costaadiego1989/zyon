# Quantidade zero — 30/10/2026

O inbox `bb3f60a1-f27b-4b15-a645-792c42b5c72e`, revisão publicada `a67f9bb`, pediu explicitamente alterar o Kit Organizador Essencial para zero unidades. O turno `4b9c2dbd-4c94-4438-a2dd-77d70e481e29` concluiu a inspeção canônica, mas o modelo passou por main/retry sem chamar ferramenta. A guarda de leitura retornou a limitação genérica; o carrinho permaneceu em R$63. Não foi uma rejeição do writer ou do seletor.

A correção trata zero como remoção explícita da linha já inspecionada. Depois da classificação de domínio e da inspeção válida, executa `update_cart_item` uma vez pela ferramenta e pela policy existentes, com carrinho, variante, quantidade e seletores canônicos. Não chama o handler bruto, não escreve diretamente no banco e não concede autorização por histórico ou anexo. O writer continua revalidando a seleção.

A projeção terminal existente confirma a alteração somente com o retorno correlacionado. Timeout ou reconhecimento perdido continuam incertos, sem retry, fallback ou narração que afirme sucesso. Negativas, citações, condições, anexos, domínio recusado e inspeção ausente/ambígua não ganham autorização.

O baseline falhou em2dos11novos testes; após a correção,106testes passaram, incluindo admissão, seleção, atualização/remoção, estoque, quantidades inválidas e consentimento. O processo interrompido terminou normalmente, sem processo de teste pendente.

Logs locais: `.audit/whatsapp-final-acceptance-20261028/local-cart-zero-before.log` e `local-cart-zero-after.log`.

Nenhum deploy, envio de mensagem ou mutação no banco de produção foi executado nesta correção. O próximo gate é publicar e repetir o comando real, confirmando que somente o Essencial sai do carrinho e o item físico de R$3 permanece.
