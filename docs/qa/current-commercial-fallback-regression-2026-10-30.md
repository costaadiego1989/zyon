# Consulta comercial com narração rejeitada — 30/10/2026

## Evidência da falha

O inbox `e697e3f0-1e6a-4ac2-9f4b-32c12ec56fd6`, deployment `22e439bb-b6ef-4b7c-9104-9ccba7e05d55`, perguntou se a oferta do Kit Completo podia ser acumulada com frete grátis, sem aplicar benefício.

Os logs do turno `cfa80950-71d4-4555-ae0f-00883aaa25d4` mostram as leituras atuais `list_promotions` e `get_daily_deals`, depois a narração e `safety_rejected`. O cartão com preço-base de R$100 veio de outro turno do adapter (`fb0da33e-b09a-4e09-86b4-4b9cfd85a20c`) ao expandir o resultado único. Não foi ausência de prefetch. O texto bruto original não foi retido.

Dois replays com provider real, contexto do mesmo inbox e consultas canônicas somente de leitura reproduziram JSON válido e rejeição `unsafe_content`. As frases negavam acúmulo de formas diferentes das reconhecidas pela exceção restrita. O DTO real retornou Completo9000, referência10000, validade30/10 às18h de Brasília e regra de acúmulo `false`. O limite progressivo10 não significa benefício concedido.

## Correção

Quando uma consulta `NEGOTIATE_PRICE` requer condições atuais, as duas leituras foram confirmadas neste turno, não há descoberta nem qualquer tentativa de escrita e a narração é rejeitada, o backend pode projetar os fatos públicos atuais. A resposta usa preços em centavos e validade dos DTOs, a regra canônica de acúmulo e a limitação da seleção. Não reutiliza a fala rejeitada, não transforma limite progressivo em oferta e não concede cupom ou isenção.

A projeção continua passando pela mesma guarda. Leitura com erro, ausente ou malformada mantém a limitação original. Operação confirmada ou incerta, inclusive uma tentativa bloqueada, não pode ser substituída por esse resumo. JSON inválido é descartado sem repair/retry de narração. Os cartões antigos são removidos apenas nesse fallback para não contradizer o preço canônico com um cartão-base.

O resumo não afirma que os produtos atendem a orçamento/atributos nem que a seleção é exaustiva. Não substitui o executor de critérios, cotação por candidato ou GraphRAG.

## Validação

98 testes focados passaram: projeção dos fatos, escopo, leitura falha, JSON inválido, guarda existente, resultado confirmado/incerto de atualização, regra de acúmulo e contrato de resposta. Não houve build completo nesta etapa.

Prova candidata em memória, usando provider real e DTOs reais do deployment22e:2/2 respostas seguras com `canonical_commercial_fallback`, preço R$90/referênciaR$100, validade correta e regrafalse; nenhum cartão conflitante. Escritas bloqueadas0, nenhuma persistência de conversa e nenhum envio. A prova não é um reteste do WhatsApp publicado.

Artefatos em `.audit/whatsapp-final-acceptance-20261028/`: `production-stack-22e-log-correlation.json`, `production-stack-22e-provider-proof.json`, `production-commercial-fallback-candidate-22e-proof.json` e `local-current-commercial-fallback-combined.log`.
