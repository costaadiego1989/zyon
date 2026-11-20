# CI fiscal do painel

O workflow `fiscal-dashboard.yml` exige as sete variáveis públicas de autenticação já validadas no build publicado: `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_MICROSOFT_CLIENT_ID`, `VITE_FACEBOOK_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URI`, `VITE_TURNSTILE_SITE_KEY` e `VITE_FACEBOOK_LOGIN_ENABLED`.

Antes de executar o CI remoto, configurar essas variáveis no repositório GitHub com os valores públicos revisados para o destino. Não incluir segredos OAuth, tokens ou chaves privadas. O guard existente rejeita configuração ausente ou inválida; não usar valores fictícios para contorná-lo. O CI não publica o painel.

Os quatro cenários de OAuth/notificações usam somente a entrada `tests/fiscal-olist.fixture.html`, com APIs simuladas, e não autorizam contas reais nem enviam notificações externas.
