# Sessões e equipe: segundo lote da API

Achados API-009, API-010 e API-011. Implementação local; os gates de implantação permanecem abertos.

## Contrato e persistência

Login, cadastro e OAuth preservam `access_token`, `token_type`, `expires_in`, `merchant_id`, `user_id`, `email` e o cookie existente. Antes de responder, a API grava uma sessão em PostgreSQL. HTTP, emissão de embed e suporte validam a sessão persistida e o usuário efetivo. `JwtService.verify` verifica somente criptografia; os pontos de autenticação usam `authenticate` assíncrono.

Refresh mantém a entrada atual por Bearer/cookie, inclusive JWT recentemente expirado. Cada `jti` é consumido uma única vez por atualização condicional sob lock do usuário. Uma família possui prazo absoluto igual à expiração do primeiro access token mais sete dias; as rotações não prolongam esse prazo. Apenas o vencedor da disputa recebe o novo token. Replays falham e não revogam o vencedor de uma corrida legítima de abas. Credencial inválida responde 401; indisponibilidade do banco responde 503 com código estático, preservando o cookie. Logout revoga a família inteira, inclusive quando usa o token anterior já consumido ou expirado com assinatura válida; outras famílias de login permanecem válidas.

Reset armazena SHA-256 de um token aleatório de 256 bits, prazo de 30 minutos e versão de credencial. Gerar outro link invalida o anterior. O consumo, a alteração da senha, o incremento de versão e a revogação de todas as sessões acontecem na mesma transação. Não há dependência de memória de uma réplica nem armazenamento do token bruto no banco.

`MerchantUser` é a fonte de papel e estado de acesso. Equipe mantém a projeção `MerchantTeamMember` sincronizada na mesma transação; mudança de papel e remoção incrementam a versão e revogam sessões e links de reset. Remoção mantém o usuário desabilitado para impedir login com senha ou OAuth. Convite de uma pessoa removida da mesma loja pode reativá-la com senha provisória nova e todas as credenciais de sessão anteriores revogadas. Contas de outra loja não são transferidas, pois a identidade atual admite um único merchant por usuário.

Todos os escritores de equipe obtêm lock por merchant; a contagem de proprietários usa usuários ativos. Administrador não promove para OWNER nem modifica/remove proprietário. A identidade do ator vem do principal autenticado e é revalidada no banco. Comandos de escrita de equipe do alias público exigem humano; API key não possui um ator humano para esses comandos. O alias público segue sujeito ao achado original de montagem de módulos.

Papéis no JWT são `owner`, `admin` e `staff`; a API de equipe conserva `OWNER`, `ADMIN`, `STAFF`. STAFF tem acesso explícito aos tickets/mensagens de suporte. Outros endpoints administrativos exigem futura política expressa por metadata; retornam 403 para STAFF sem a permissão. O socket de suporte revalida a sessão em cada evento. Logout não remove retroativamente dados já entregues nem cancela operações que já passaram pela autenticação.

## Migração e limites

Aplicar `20260905180000_durable_merchant_auth` no diretório ativo de migrações, depois da baseline integrada e antes deste código. A migração normaliza papéis com membership da mesma loja; admin/staff sem membership da mesma loja e papéis desconhecidos ficam desabilitados para revisão. Owners sem membership recebem projeção de bootstrap. O legado não distingue um owner inicial sem projeção de um owner que foi removido pelo código antigo: revisar esses owners antes da liberação. Memberships legadas de outro tenant não concedem acesso a esse tenant.

Tokens emitidos antes da migração não têm sessão persistida e deixam de autenticar; comunicar novo login. Links antigos de reset em memória também devem ser reemitidos. Drenar réplicas antigas durante a troca: elas não consultam o banco de sessões e reintroduzem acesso revogado. Rollback para o código antigo reabre os achados. Preservar tabelas até decisão de recuperação. Os registros expirados precisam de política operacional de retenção e limpeza; este lote não adiciona uma rotina de limpeza.

O convite mantém o fluxo existente de senha provisória por email, agora com 128 bits aleatórios antes do sufixo. O envio ocorre depois do commit; uma falha de entrega não desfaz o usuário e pode exigir recuperação de senha. Entrega real de email, experiência de login STAFF no dashboard, renovação simultânea entre abas e fluxos browser completos ainda precisam de validação integrada.

## Evidência

Os testes PostgreSQL de `auth-sessions.integration.spec.ts` cobrem duas instâncias de cliente/repositório, 20 refreshes simultâneos de token expirado com um vencedor, logout de família, 20 consumos concorrentes de reset com uma alteração, hash no banco, expiração/substituição, os três papéis com login/redução/remoção, ator ausente e falsificado, disputa de último owner e convites entre tenants. Os testes de guards cobrem STAFF por metadata e o contrato HTTP 403. Testes de controller verificam que cookie e resposta aguardam confirmação da operação persistente. A evidência consolidada do segundo lote registra os totais e limitações de ambiente.
