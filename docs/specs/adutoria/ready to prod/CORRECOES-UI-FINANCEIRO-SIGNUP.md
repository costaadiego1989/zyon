# Financeiro, KPIs e signup — 2026-09-09

## Alterações

- Financeiro e Pedidos e Envios compartilham PeriodFilter: botões de período e campos de data com altura de 40 px, intervalo acessível e quebra responsiva.
- Financeiro usa o espaçamento padrão de page-head/page-container, sem o painel adicional em torno dos filtros.
- StatCard centraliza a apresentação dos indicadores, com valor principal, contexto opcional, cores do tema e grupos responsivos.
- Favicon Zyon adicionado ao dashboard. Viewport e idioma declarados no HTML.
- Lateral do signup restaurada ao visual anterior à alteração em 6909aae: orb, logo e texto centralizado. Fluxos de autenticação preservados.
- Etapa de planos redesenhada com escolha por radio, preços e limites do catálogo da API, detalhes expansíveis e botão persistente. Container rola sem perder acesso à ação; planos pagos continuam passando pelo Stripe.
- Removida a largura mínima de 1320 px que cortava o dashboard em celulares. Navegação compacta permite trocar páginas e sair da conta.

## Evidências

- Build/typecheck do dashboard.
- Playwright em 1440, 1280, 390 e 320 px: rolagem dos planos, botão acessível, ausência de corte horizontal dos campos, filtros de hoje e altura de 40 px.
- Inspeção visual das capturas locais em .audit/ui-refinement: planos, Financeiro desktop/mobile e lateral restaurada do signup.
- Catálogo e dados financeiros simulados nos testes visuais; nenhum plano real contratado.

As contas financeiras, taxas do catálogo e endpoints de faturamento permanecem com a semântica existente. O trabalho altera apresentação e acessibilidade.
