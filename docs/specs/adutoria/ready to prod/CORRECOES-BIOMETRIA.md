# Login biométrico do comprador — 2026-09-09

## Problema constatado

O botão do storefront reutilizava um token em localStorage, sem chamar o autenticador. Não havia ativação no Hub. A API interpretava a attestation CBOR como authenticatorData bruto e esperava chave/assinatura em formatos diferentes dos produzidos pelos navegadores. Os desafios ficavam somente na memória do processo.

## Correção

- Hub e checkout usam o mesmo fluxo WebAuthn. Ativação em Hub → Configurações exige sessão válida, obtida previamente por e-mail.
- Cadastro cria uma credencial discoverable no autenticador de plataforma. Login invoca navigator.credentials.get e só inicia uma sessão após a API validar a assinatura.
- API verifica challenge, origem, RP ID, tipo da cerimônia, identidade da credencial, presença e verificação do usuário com @simplewebauthn/server 13.3.0. Public keys persistidas em COSE; chaves privadas e dados biométricos ficam no autenticador.
- Desafios compartilhados no Redis, com expiração de cinco minutos e consumo atômico. Sem Redis, o fluxo falha explicitamente. O acesso por e-mail continua disponível.
- Contadores são atualizados condicionalmente no Prisma para impedir rollback concorrente. Passkeys com contador zero são aceitas conforme o protocolo.
- DTOs validam dados aninhados e tamanhos. Cadastro exige BuyerJwtAuthGuard; IDs de usuários não são aceitos do corpo do pedido.
- Cancelamento ou indisponibilidade apresenta orientação para acesso por e-mail. Não há mais autenticação pelo marcador local antigo.

## Validação executada

- Build completo da API, build/typecheck do storefront.
- 33 testes: formato real CBOR/COSE/DER, cadastro e login, JWT, replay, challenge, origem, RP ID, presença/UV, validação HTTP, persistência compartilhada e atualização concorrente.
- Playwright com autenticador Chromium CTAP2 de plataforma: controller Nest e guard reais, cadastro via navigator.credentials.create, login discoverable via navigator.credentials.get, JWT verificado, sessão do Hub e cancelamento sem apagar a sessão válida.
- Dados de teste isolados em memória; nenhuma compra ou conta real é criada por esses testes.

Comandos reproduzíveis:

```sh
pnpm --filter @zyon/api test:buyer-webauthn
node apps/storefront/scripts/verify-buyer-webauthn.cjs
pnpm --filter @zyon/storefront build
```

## Limites

A biometria disponível depende do dispositivo: Face ID, impressão digital ou PIN. O teste virtual não substitui a confirmação com Face ID físico.

A configuração de produção inspecionada usa o RP zyon-payments.com.br e a origem https://storefront.zyon-payments.com.br. Domínios personalizados não passam a compartilhar credenciais automaticamente; nesses endereços o e-mail permanece como alternativa. Nenhuma origem enviada pelo cliente altera o RP autorizado. Credenciais antigas em formato incompatível precisam ser cadastradas novamente após acesso por e-mail.
