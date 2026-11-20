# Publicação fiscal

A API, o storefront e o widget devem usar a revisão fiscal composta sobre a versão publicada. O dashboard possui uma branch própria com o código fiscal e a navegação publicada. Não publicar o snapshot privado de desenvolvimento nem usar a branch do dashboard para implantar a API.

## Antes da publicação

- Fixar os SHAs por serviço e confirmar que a versão publicada não avançou durante a validação. Registrar os oito checksums das migrações fiscais.
- Executar o CI fiscal completo e o CI do dashboard, sem filtros ou skips. Os testes de upgrade usam uma projeção do modelo publicado; não comprovam reconstrução de uma instalação vazia pelo histórico antigo ausente.
- Conferir a configuração dos URLs públicos da API e dashboard, a chave de criptografia persistente e o processamento de outbox no ambiente escolhido. Nunca gerar uma chave nova para substituir silenciosamente uma chave que já protege credenciais.
- Configurar a conta e as permissões do ERP/emissor por lojista. Conectar a conta não ativa emissão sem os controles fiscais de preparação existentes. A assinatura/transmissão pertence ao ERP/emissor; a Zyon não usa um certificado emprestado.
- O início do worker de estoque consome a fila imediatamente. Não existe uma flag de pausa de estoque validada nesta entrega. Preparar a interrupção dos writers antigos antes de iniciar o candidato; evitar sobreposição de réplicas antigas e novas.

## Corte dos writers de estoque

Inventariar, com acesso somente leitura e por merchant/conexão, todos os jobs `full` e `sale`, incluindo jobs concluídos com tentativas anteriores, receipts e marcadores `payload.stockExecution`. Não selecionar credenciais ou payloads fiscais completos. Validar o schema utilizado pela sessão.

Interromper os consumidores antigos e impedir novas execuções administrativas/cron/outbox que enviem estoque por esses binários. Preservar o recebimento durável dos eventos comerciais pelo procedimento operacional da aplicação. Encerrar processos ou expirar um lease não comprova que uma requisição já enviada ao ERP terminou. Se não for possível isolar os writers, não iniciar o corte.

Repetir o inventário após a interrupção. Para Tiny/Bling, uma venda antiga iniciada, sem marcador e concluída após erro anterior pode ainda representar uma escrita absoluta atrasada. O código mantém uma barreira conservadora sobre esse histórico. Identificar receipts/SKUs afetados; receipt ilegível pode exigir bloquear a conexão. Não reclassificar essas linhas como nunca enviadas, zerar tentativas ou apagar jobs para liberar estoque.

Aplicar as migrações pelo fluxo normal de predeploy, iniciar somente a revisão nova e observar revisão servida, health, filas e marcadores por SKU. Não interpretar um job agregado `completed` como confirmação de todos os itens. Não fabricar compras ou notas reais como parte desse procedimento.

## Retorno incerto do ERP

Tiny/Bling persistem um marcador por item antes do HTTP. Timeout, morte do processo ou falha ao persistir o acknowledgement podem deixar o item pendente. O mesmo SKU fica protegido contra reenvio e importação de saldo obsoleto; SKUs independentes podem continuar. Reconectar ou desconectar a conta não deve apagar essa evidência.

Não há leitor de confirmação terminal do provedor registrado em produção nesta entrega. Portanto uma pendência incerta não possui liberação operacional automática nem rota pública de desbloqueio. A porta interna de verificação e seus testes não representam uma confirmação externa real. Igualdade de saldo, passagem de tempo e um JSON informado pelo cliente não provam que a tentativa terminou.

Omie conserva a baixa relativa e a chave original da venda. Não atribuir a ela uma nova garantia de transporte pelos resultados dos testes de escrita absoluta Tiny/Bling.

## Contenção e retorno de versão

Não voltar writers ao binário anterior por um rollback simples: o código antigo não reconhece os marcadores e pode repetir uma escrita. Se houver falha, interromper os writers afetados, preservar jobs/receipts/marcadores e revisar o estado antes de escolher o procedimento de recuperação. Não executar `migrate resolve`, apagar histórico ou modificar dados para fazer o estado parecer concluído.

Os testes locais e as respostas simuladas de contrato não comprovam autorização SEFAZ, entrega real por e-mail/WhatsApp ou execução do ERP em produção. Essas evidências devem ser registradas separadamente para a conta e o ambiente usados.
