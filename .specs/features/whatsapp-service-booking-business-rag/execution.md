# Execution Evidence

## T1: Complete Baseline

**Assumptions**: API722 é a base preservada; frontend f103 é fonte Git limpa, com publicação histórica comprovada apenas para widget. Não presumir frontend concorrente do principal como publicado.

**Files to touch**: três árvores frontend ausentes (`apps/dashboard`, `apps/storefront`, `apps/widget_v2`); somente documentos desta feature (spec/context/design/tasks/baseline e manifesto/script de curadoria). API/packages/lock/configs não recebem alteração.

**Success criteria**: 1.259 fontes Git copiadas sem sobrescrita divergente, hashes de destino iguais à origem, shared packages idênticos e reutilizados, ausência de segredos/deploy/builds, importers compatíveis com lock preservado e diff check limpo. T1 é documental, sem teste artificial.

**Gate**: PASS documental: 1.259 arquivos conferidos contra SHA-256 de origem; API/packages/lock sem diff; metadata nova passa diff check; importers frozen/offline aceitos. Linking interrompido para não concorrer com baseline do root, sem download/resolução. Whitespace herdado de source importado permanece registrado em baseline.md, sem reformatar código aprovado. Nenhuma condição de venda, pedido, estoque, pagamento ou mensagem foi alterada.
