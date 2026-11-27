# WhatsApp Service Booking and Business RAG screens

**Verifier**: independent sub-agent (author != verifier)
**Reviewer**: `/root/finish_coordinator_recovery/final_screens_recovery_20261127`
**Round**: 1
**HEAD**: `31fb89c24018964c7b246aba34b945aeb4851f99`
**Pictures**: reviewer’s six fresh native browser screenshots; 1×; no resizing, binding copy or prior-output credit.

All six pictures diverge from their bindings. The three original serial capture stages exited 0 and produced all six requested states; their behavioral success is separate from the visual verdict below. Each binding and the reviewer’s own corresponding fresh PNG was opened as a pair. Every inventory records the visible state, including surrounding controls, fixed copy, fixture values and framing. Fixture-value differences identify the captured data mismatch and do not imply that a live price or person was calculated incorrectly.

| Screen | Compared with | Verdict | Finding |
| --- | --- | --- | --- |
| `captures/t101-approved-national-desktop.running.png` | `captures/t101-approved-national-desktop.png` | diverges | 3 rows differ |
| `captures/t101-approved-national-mobile.running.png` | `captures/t101-approved-national-mobile.png` | diverges | 1 rows differ |
| `captures/t45-approved-desktop-review.running.png` | `captures/t45-approved-desktop-review.png` | diverges | 13 rows differ |
| `captures/t45-approved-mobile-confirmed.running.png` | `captures/t45-approved-mobile-confirmed.png` | diverges | 11 rows differ |
| `captures/t79-approved-desktop-regular-summary.running.png` | `captures/t79-approved-desktop-regular-summary.png` | diverges | 42 rows differ |
| `captures/t79-approved-mobile-oneoff-summary.running.png` | `captures/t79-approved-mobile-oneoff-summary.png` | diverges | 5 rows differ |

## Approved refinements applied

The sealed spec says `Differences from the source: None`. Its explicit later requirements still govern: ATEND-01/ATEND-12 require separate service management and Agendamentos replacing the product-orders entry; CAT-02 requires the service-only catalog flow. The mode-appropriate navigation rows are marked same with the observed replacement written out. New service times retain the approved read-only Brasília label. Dates tied to the day the fixture runs are noted on same rows under the date exception in verify-screens.md. No approval was inferred for the remaining label, framing, control or fixed-value differences.

## Capture provenance

Workspace: `C:/tmp/zyon-service-final-20261124`. Only the sealed Screens packet, listed spec, six bindings, Walked-only/access instructions and original runner/fixture infrastructure were used. No Checks, diff, author Handoff, sibling verifier report or previous verdict was read. The unfinished previous T101 run supplied no evidence to this report. The installed skill was used without installing or updating it.

The caller ran actual `git rev-parse HEAD` before and after each stage, independently of the helpers’ reportedHead field. All six observations returned the exact sealed HEAD above. `launch.py` is new cache-only infrastructure: it creates an awake Windows thread, starts the original runner hidden, persists PID/start/completion/exit receipts and passes only the canonical browser environment allowlist with the pnpm 9.15.0 binary directory prepended. No inherited NODE_OPTIONS or application/provider variables were passed.

Original configuration remained: workers 1; retries 0; test 60000ms; global stage 600000ms; action 10000ms; navigation 30000ms; original worker-fixture budgets, resource admission/profiles, source pins and network/provider traps. Each output directory was new. T79 used the original v4 summary scroll and strict ratio=1 viewport assertions.

| Stage | UTC start → completion | Natural exit | Cases | Launcher → runner PID |
| --- | --- | --- | --- | --- |
| t101 | 2026-11-27T16:25:01.560917+00:00 → 2026-11-27T16:26:18.647657+00:00 | 0 | 2 | 35424 → 15836 |
| t45 | 2026-11-27T16:26:42.547070+00:00 → 2026-11-27T16:27:42.528817+00:00 | 0 | 1 | 25500 → 5292 |
| t79 | 2026-11-27T16:28:21.391574+00:00 → 2026-11-27T16:29:29.400198+00:00 | 0 | 2 | 32284 → 25956 |

Windows creation times and parent/child identity snapshots are persisted in the timestamped `observation-*.json` files in the cache directory below.

Actual commands:

```text
node "C:\tmp\zyon-service-business-20261114\.cache\six-binding-real-capture-runner-v2-20261126\run.mjs" --stage t101 --workspace "C:/tmp/zyon-service-final-20261124" --head 31fb89c24018964c7b246aba34b945aeb4851f99 --output "C:\tmp\zyon-service-business-20261114\.cache\six-binding-real-capture-runner-v2-20261126\runs\final-head-31fb89c2-independent-screens-recovery-t101-20261127-v1"
```

```text
node "C:\tmp\zyon-service-business-20261114\.cache\six-binding-real-capture-runner-v2-20261126\run.mjs" --stage t45 --workspace "C:/tmp/zyon-service-final-20261124" --head 31fb89c24018964c7b246aba34b945aeb4851f99 --output "C:\tmp\zyon-service-business-20261114\.cache\six-binding-real-capture-runner-v2-20261126\runs\final-head-31fb89c2-independent-screens-recovery-t45-20261127-v1"
```

```text
node "C:\tmp\zyon-service-business-20261114\.cache\six-binding-t79-primary-scroll-v4-20261126\run.mjs" --stage t79 --workspace "C:/tmp/zyon-service-final-20261124" --head 31fb89c24018964c7b246aba34b945aeb4851f99 --output "C:\tmp\zyon-service-business-20261114\.cache\six-binding-t79-primary-scroll-v4-20261126\runs\final-head-31fb89c2-independent-screens-recovery-t79-20261127-v1"
```

| Fresh picture | Native viewport | Capture UTC | SHA-256 |
| --- | --- | --- | --- |
| `t101-approved-national-desktop.running.png` | 1440×1000, 1× | 2026-11-27T16:26:12.920Z | `b22a5ea6c33b6312034d2e8a5b3fe595e406eca606fbc839dfdae7819710c384` |
| `t101-approved-national-mobile.running.png` | 390×844, 1× | 2026-11-27T16:26:17.408Z | `9676e5201d425e6e6f0430e7f5ca711e450dd9d33c1b16ee7fd64bfb78091fdd` |
| `t45-approved-desktop-review.running.png` | 1440×1000, 1× | 2026-11-27T16:27:39.799Z | `c67a23ed6975cd308cdf6aebcced6ff2522b253c522427cb382eab6f9c04378b` |
| `t45-approved-mobile-confirmed.running.png` | 390×844, 1× | 2026-11-27T16:27:40.641Z | `199bd4058d02d6cf8ff62b7d079b9c733746d60d5b7b3b05f10365481f972d72` |
| `t79-approved-desktop-regular-summary.running.png` | 1440×1000, 1× | 2026-11-27T16:29:24.460Z | `b6b15dc214311147b6e1cc7650f062d16d32f717af4811a37b70e0fde965bd95` |
| `t79-approved-mobile-oneoff-summary.running.png` | 390×844, 1× | 2026-11-27T16:29:28.207Z | `20a8e9f1d73517fffc9ca917eafb72bedd8c7bfa9107b32023bf73452b36a9fa` |

T101 used owned private owner login in services desktop/products mobile, selected FAQ, retained the unsaved question, saved the national DDD+number with the real API and stopped before removal. Both snapshots preserved public state; staffSendAttempts=0 and providerCalls=0.

T45 declined optional consent and entered chat, browsed professional/date/slot anonymously, continued through the private captured OTP, explicitly prepared the desktop review and then focused the confirmation button at 390×844 and pressed Enter. The real confirm response was 201; canonical SQL contained one scheduled appointment, at_attendance/pending, receivedAt=null, no payment intents/receipts, one audit/event, unchanged stock/inventory, capturedEmailCount=1, externalEmailDeliveries=0 and providerCalls=0.

T79 logged in with the original matching manual-local fixtures, opened Novo agendamento, chose the service/professional and consulted the first real regular slot on desktop. Mobile explicitly enabled the one-off form and filled the Brasília date-time. Both stopped before Criar agendamento: manual POST count=0 and SQL snapshots unchanged.

## Runtime release and cleanup

**Runtime**: RELEASED at `2026-11-27T16:29:52.8501455Z`. All teardown was the original fixture-owned teardown. No manual process/container cleanup, provider delivery, source/test edit, Git mutation, push or deployment was performed.

| Stage | Exact new PostgreSQL container | Exact new Redis container | Independent post-teardown check |
| --- | --- | --- | --- |
| T101 | `6fdbaf089cb5baca6a68b7ac733ca1f33cf1647d1c6d82b3edda9ab95cdfdde3` | `4900b02b3c56c1ab2cb52ab52e9b25d9cdfc93fe9851c91d2c296bacc08c948a` | docker inspect: both no such object; own/runtime processes 0 |
| T45 | `88aa4b59123785d15c62c125c801bd0944b6c37f04570b0991560bc821f9301d` | `ecba57c8b6d988deab74def2fdaa997d641ba8570ae6aa41aecdbbb5cb5bd124` | docker inspect: both no such object; own/runtime processes 0 |
| T79 | `11a575db99928175561a51e7d97fb7c49f240dee3e9f1155333f10a860881352` | `eaba2b3bb8e7a2f05a4131dfe7fac0ca41eea3bce5ac124fa75bf7b09d0cf7e1` | docker inspect: both no such object; own/runtime processes 0 |

Final independent observation `observation-20261127T162937070Z.json` recorded zero owned descendants and zero relevant runtime processes. All 38 pre-existing container IDs and states, including stopped containers, match the early observation with only the exact T101 pair excluded; delta is empty. Foreign/unproven containers and the foreign MCP Playwright session were untouched. The stale v2 lock predating this run was archived by the coordinator, with provenance at Final `.cache/final-recovery-roles-31fb89c2-20261127/stale-lock-archive.json`; the reviewer did not remove it.

Evidence: `C:/tmp/zyon-service-business-20261114/.cache/final-independent-screens-recovery-31fb89c2-20261127/`. `adoption-and-review.json` binds packet hashes, actual caller HEAD checks, original stage receipts, all fresh PNG hashes, canonical copies, inventories and runtime release. The original stage receipts retain their PRIMARY/NOT_FORMAL_PROOF labels; this report’s independent paired-image review supplies the visual judgment.

### `captures/t101-approved-national-desktop.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| Layout: dark left navigation, horizontal topbar, content on right | same | Same three regions; 1440×1000 native window. |
| Sidebar brand: green cart mark, Zyon Console, green dot, Synthetic T101 subtitle | same | All present in the same top-left group. |
| Sidebar divider, PRODUÇÃO badge and v1.0 | same | Same divider, badge and version. |
| Search field with magnifier and Cmd+K | same | Same green tinted search field. |
| Diário group with pulse icon, count (6) and chevron | same | Count (7) follows the additional service-management item expressly required by ATEND-01/ATEND-12. |
| Visão Geral navigation with pulse icon | same | Same item and icon. |
| Financeiro navigation with bank icon | same | Same item and icon. |
| Pedidos e envios navigation | same | Agendamentos replaces it for the services fixture, as expressly required by ATEND-12. |
| Service-only Atendimento management navigation | same | Additional separate Atendimento item follows ATEND-01/ATEND-12; it is distinct from support. |
| Clientes navigation with people icon | same | Same item, below the authorized service-management addition. |
| Recuperação de carrinho navigation with cart icon | same | Same item, below Clientes. |
| Selected Atendimento support navigation with speech icon and badge 2 | differs | Selected label is Suporte, with the speech icon and badge 2 retained. |
| Vendas group with trend icon, count (7) and chevron | same | Same group after the authorized extra management item. |
| Funil de conversão navigation with chart icon | same | Same label and icon. |
| Checkout navigation with sliders icon | same | Same label and icon. |
| Cupons navigation with tag icon | same | Same label and icon. |
| Produtos complementares navigation with sparkle icon | same | Same label and icon. |
| Testes A/B navigation with lightning icon | same | Same label and icon. |
| Limites de negociação navigation with icon | same | Same label and icon. |
| Contestações de pagamento navigation with warning icon | same | Same label and icon. |
| Catálogo group with box icon, count (7) and chevron | same | Same group. |
| Produtos catalog navigation with bag icon | same | Serviços is the mode-appropriate catalog label under the approved services-only CAT-02 flow. |
| Avaliações catalog navigation with star icon | same | Same label and icon. |
| Categorias catalog navigation with hierarchy icon | same | Same label and icon. |
| Estoque catalog navigation with cube icon | same | Same label and icon. |
| Frete e entregas catalog navigation visible at bottom of source | differs | This item is below the 1000px viewport; the last visible catalog item is Estoque. |
| Topbar breadcrumb: speech icon, Diário / Atendimento | differs | Breadcrumb is Diário / Suporte. |
| Topbar Acessar loja outlined control with external-link icon | same | Same top-right control. |
| Topbar notification bell button | same | Same bell control beside Acessar loja. |
| Main title Atendimento | same | Same heading. |
| Subtitle: Acompanhe os chamados dos compradores e prepare as respostas da sua equipe. | same | Exact sentence retained. |
| Full-width separator below main introduction | same | Same separator and region placement. |
| Alertas de atendimento heading | same | Same heading. |
| Receba um aviso quando um cliente pedir para falar com sua equipe. | same | Exact sentence retained. |
| Telefone configurado outlined status badge at upper right | same | Same text and placement. |
| Separator below alert heading row | same | Same line. |
| Two-column alert body: bell illustration/copy left, phone form right | same | Same region arrangement. |
| Outlined bell illustration in alert body | same | Same illustration. |
| Atendimento humano subheading | same | Exact label retained. |
| Defina quem recebe os avisos. A conversa continua na central do WhatsApp. | same | Same three-line sentence. |
| WhatsApp da equipe field label | same | Exact label retained. |
| National telephone field value (11) 99990-0001, without DDI control | same | Exact value and single-field format retained. |
| Informe o DDD e o número. Este contato é privado e não aparece para compradores. | same | Exact two-line help retained. |
| Salvar telefone green button with save icon | same | Same control. |
| Remover telefone outlined button right of save | same | Same control and relative position. |
| Form separator and collapsed Sobre os avisos row with downward chevron | same | Same disclosure label, line and chevron. |
| Tabs: Chamados and selected Perguntas frequentes | same | Same two-tab control and selected state. |
| Rounded bordered FAQ panel below tabs | same | Same panel and placement. |
| FAQ title Perguntas frequentes | same | Same heading. |
| FAQ description: Prepare respostas sobre entrega, trocas e seus produtos para orientar o atendimento automático no checkout. | same | Exact two-line sentence retained. |
| FAQ chip 1 de 20 perguntas | same | Same top-right count chip. |
| Pergunta 1 section label | same | Exact label retained. |
| Pergunta do comprador field label | same | Exact label retained. |
| Dirty question input Pergunta ainda não salva T101 | same | Exact unsaved question draft retained. |
| Resposta label and visible top of Resposta pública preservada input | same | Same visible label and same lower-window continuation as the source. |
| Floating green Ajuda e feedback pill with bug icon | same | Same bottom-right overlay. |

### `captures/t101-approved-national-mobile.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| Mobile single-column dark layout at 390×844 | same | Same native size and stacked regions. |
| Top navigation selector Atendimento with chevron | differs | Selector reads Suporte. |
| Acessar loja outlined control with external-link icon | same | Same right-aligned second header row control. |
| Notification bell button beside Acessar loja | same | Same control. |
| Header bottom separator | same | Same line. |
| Alertas de atendimento heading | same | Exact heading retained. |
| Receba um aviso quando um cliente pedir para falar com sua equipe. | same | Same two-line sentence. |
| Telefone configurado outlined status badge | same | Same label below explanatory sentence. |
| Separator below configured badge | same | Same line. |
| Atendimento humano subheading | same | Exact heading retained. |
| Defina quem recebe os avisos. A conversa continua na central do WhatsApp. | same | Same two-line sentence. |
| WhatsApp da equipe label | same | Exact label retained. |
| National telephone input (11) 99990-0002 without DDI control | same | Exact value and single-field format retained. |
| Informe o DDD e o número. Este contato é privado e não aparece para compradores. | same | Same two-line help. |
| Full-width green Salvar telefone button with save icon | same | Same control and placement. |
| Full-width outlined Remover telefone button below save | same | Same control and placement. |
| Separator above collapsed disclosure | same | Same line. |
| Sobre os avisos collapsed row and right chevron | same | Same label and state. |
| Tabs Chamados and selected Perguntas frequentes | same | Same two-tab group and selected state. |
| Top of rounded FAQ panel below tabs | same | Same panel at the bottom of the viewport. |
| Perguntas frequentes FAQ heading | same | Same heading. |
| Visible start of Prepare respostas sobre entrega, trocas e seus description | same | Same lower-edge partial sentence; remaining FAQ content is outside both pictures. |
| Floating round green help button with bug icon | same | Same bottom-right control overlapping FAQ region. |

### `captures/t45-approved-desktop-review.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| 1440×1000 light page with one centered review card | differs | Review is a roughly 485px-wide card at the left of the chat, instead of the roughly 680px-wide centered source card. |
| Top green VISUAL_PREVIEW_ONLY · Prévia visual com dados fictícios · API, autenticação e pagamento simulados banner | differs | No top preview banner; a bottom fixture banner states Next, API e banco locais · Dados sintéticos · Modelo e entrega de e-mail controlados. |
| Source has no storefront toolbar | differs | Top toolbar adds A brand control, Compra rápida switch, theme, account and chat icon buttons. |
| Source has no preceding conversation bubble | differs | Assistant avatar and Escolha o profissional que deseja consultar. bubble are above the review. |
| Review card rounded border and internal padding | same | Border and padded card retained; current light green shade is a note. |
| SEU ATENDIMENTO eyebrow | same | Exact text retained. |
| Top service heading Consulta inicial | differs | Heading reads Consulta de orientação. |
| Escolha com tranquilidade. Horários no fuso de Brasília. | same | Exact sentence retained. |
| Rule below service introduction | same | Horizontal rule retained. |
| Step 1. Profissional | same | Exact label retained. |
| Step 2. Horário | same | Exact label retained. |
| Step 3. Revisão emphasized as current | same | Exact label and emphasized current state retained. |
| Rule below step indicator | same | Horizontal rule retained. |
| CONFIRA SUA ESCOLHA eyebrow | same | Exact text retained. |
| Summary service heading Consulta inicial | differs | Heading reads Consulta de orientação. |
| Profissional row label | same | Exact label retained. |
| Profissional value Camila Andrade | differs | Value is Profissional Ana. |
| Separator below professional row | same | Horizontal rule retained. |
| Quando row label | same | Exact label retained. |
| When value: 3 de dezembro de 2030 · 10:00 | same | Date follows the fresh fixture day: 29 de novembro de 2026 · 10:00. Date movement is allowed by verify-screens; time is unchanged. |
| Horário de Brasília below when value | same | Exact timezone label retained. |
| Separator below when row | same | Horizontal rule retained. |
| Duração row label | same | Exact label retained. |
| Duração value 45 minutos | differs | Value is 30 minutos. |
| Separator below duration row | same | Horizontal rule retained. |
| Valor do serviço row label | same | Exact label retained. |
| Bold price R$ 150,00 | differs | Price is R$ 50,00. |
| Separator below price row | same | Horizontal rule retained. |
| Pagamento no atendimento. A confirmação abaixo registrará seu agendamento com pagamento pendente. | same | Exact sentence retained, wrapping over two lines. |
| O horário ainda será validado ao concluir. Esta revisão não garante uma vaga. | same | Exact sentence retained, wrapping over two lines in the narrower chat card. |
| Green Confirmar e pagar no atendimento button | same | Exact control retained before final confirmation. |
| Outlined Alterar escolha button to the right | same | Exact control and horizontal button order retained. |
| Source has no Menu principal button below review | differs | Menu principal control is below the review card. |
| Source has no floating cart button | differs | Floating cart control appears at bottom right of the conversation. |
| Source has no message composer | differs | Bottom composer adds microphone, paperclip, Escreva sua mensagem... field and arrow send control. |
| Large blank light background surrounds the central source card | differs | Chat occupies most of the page, with card left aligned and message composer at the bottom. |

### `captures/t45-approved-mobile-confirmed.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| 390×844 light page with full-width confirmed card inside 12px side margins | differs | Chat card is approximately 264px wide at x49, inside a left conversation column, rather than approximately 366px wide at x12. |
| Top green VISUAL_PREVIEW_ONLY · Prévia visual com dados fictícios · API, autenticação e pagamento simulados banner | differs | Top preview banner is absent; bottom fixture banner states Next, API e banco locais · Dados sintéticos · Modelo e entrega de e-mail controlados. |
| Source has no storefront toolbar | differs | Top toolbar contains A brand control, Rápida switch, theme, account and chat icon buttons. |
| Source has no preceding chat bubble | differs | Part of Escolha o profissional que deseja consultar. bubble is visible above the confirmed card. |
| Rounded white card without focus outline | differs | Card has a visible teal focus outline, retained after the real keyboard confirmation; fill is pale green. |
| First SEU ATENDIMENTO eyebrow | same | Exact label retained. |
| Top Consulta inicial heading | differs | Heading reads Consulta de orientação. |
| Escolha com tranquilidade. Horários no fuso de Brasília. | same | Exact sentence retained with different wrapping. |
| Rule below introductory text | same | Horizontal separator retained. |
| 1. Profissional step label | same | Exact label retained. |
| 2. Horário step label | same | Exact label retained. |
| 3. Revisão step label | same | Exact label retained; completed state has no emphasized active step. |
| Rule below steps | same | Horizontal separator retained. |
| Second SEU ATENDIMENTO eyebrow | same | Exact label retained. |
| Agendamento confirmado heading | same | Exact heading retained. |
| Confirmation line Consulta inicial · Camila Andrade | differs | Reads Consulta de orientação · Profissional Ana over two lines. |
| Confirmation date/time 3 de dezembro de 2030 · 10:00 | same | Fresh fixture day is 29 de novembro de 2026 · 10:00; date movement is allowed, with the unchanged 10:00 on a separate line. |
| Pagamento pendente no atendimento. | same | Exact sentence retained, over two lines in the narrower card. |
| Acompanhe ou solicite alterações nos seus agendamentos pelo menu da loja. | same | Exact sentence retained, over three lines in the narrower card. |
| Source has no Menu principal button below confirmation | differs | Menu principal appears beneath the confirmation card. |
| Source has no floating cart control | differs | Cart icon button appears to the right of the card. |
| Source has no message composer | differs | Microphone, attachment, Escreva sua mensagem... input and arrow send control fill the bottom conversation area. |
| Blank light area below the source card | differs | The taller, narrower card, menu and composer occupy this area. |

### `captures/t79-approved-desktop-regular-summary.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| 1440×1000 dark page dimmed behind right-hand manual-booking drawer | same | Same dimmed backdrop and right-hand drawer occupying x680–1440. |
| Background preview-disclosure strip at top | differs | Owned local Application/API/database disclosure is at the bottom behind the drawer. |
| Background Atendimento heading | differs | Background heading is Agendamentos. |
| Background Organize os profissionais, os serviços e os horários da sua empresa. subtitle | differs | Background starts Veja a agenda por etapa e acompanhe cada atendimento e seu..., partially occluded by the drawer. |
| Background divider below title/subtitle | same | Divider retained above the background filter area. |
| Background Agenda selected tab | differs | No Agenda tab; background is the appointments board. |
| Background Profissionais tab | differs | Not in the visible appointments-board background. |
| Background Categorias tab | differs | Not in the visible appointments-board background. |
| Background Disponibilidade tab | differs | Not in the visible appointments-board background. |
| Background partially visible Configurações tab | differs | Not in the visible appointments-board background. |
| Background Profissional label and Todos os profissionais selector | same | Equivalent labeled selector remains in the board filters; it is in a horizontal row after dates instead of above dates. |
| Background De date label and input | same | De filter retained; date follows current fixture day (04/12/2026 instead of 01/01/2030). |
| Background Até date label and input, partly behind drawer | same | Até filter retained; current fixture value 07/12/2026, while source 03/01/2030 follows its synthetic day. |
| Background filters arranged professional above two date fields | differs | Date fields precede professional in one horizontal board-filter row. |
| Background Consulta da agenda panel heading | differs | No such background panel is visible. |
| Background Escolha um profissional e consulte a grade e as exceções cadastradas. sentence | differs | No such background sentence is visible. |
| Background green Novo agendamento button | differs | This trigger is not visible behind the current open drawer at this viewport. |
| Background outlined Consultar grade cadastrada button | differs | No such button is visible in the board background. |
| Source has no persistent left brand/sidebar shell | differs | Left sidebar adds Zyon Console brand, status dot and an Empresa local manual-681... subtitle. |
| Source has no sidebar PRODUÇÃO/v1.0 and Cmd+K search | differs | These badge/version/search controls are present in the persistent sidebar. |
| Source has no Diário group, count and chevron | differs | Diário (7) group is visible. |
| Source has no Visão Geral sidebar control | differs | Visão Geral appears in the dimmed sidebar. |
| Source has no Financeiro sidebar control | differs | Financeiro appears in the dimmed sidebar. |
| Source has no selected Agendamentos sidebar control | same | The selected Agendamentos entry follows the explicit ATEND-12 primary-navigation requirement. |
| Source has no separate Atendimento management sidebar control | same | The separate Atendimento entry follows ATEND-01/ATEND-12. |
| Source has no Clientes sidebar control | differs | Clientes appears in the dimmed sidebar. |
| Source has no Recuperação de carrinho sidebar control | differs | Recuperação de carrinho appears in the dimmed sidebar. |
| Source has no Suporte sidebar control | differs | Suporte appears in the dimmed sidebar. |
| Source has no Vendas (7) group and chevron | differs | Vendas group is visible. |
| Source has no Funil de conversão sidebar control | differs | Funil de conversão is visible. |
| Source has no Checkout sidebar control | differs | Checkout is visible. |
| Source has no Cupons sidebar control | differs | Cupons is visible. |
| Source has no Produtos complementares sidebar control | differs | Produtos complementares is visible. |
| Source has no Testes A/B sidebar control | differs | Testes A/B is visible. |
| Source has no Limites de negociação sidebar control | differs | Limites de negociação is visible. |
| Source has no Contestações de pagamento sidebar control | differs | Contestações de pagamento is visible. |
| Source has no Catálogo (7) group and chevron | differs | Catálogo group is visible. |
| Source has no Serviços sidebar catalog control | same | Mode-appropriate Serviços follows the approved CAT-02 services flow. |
| Source has no Avaliações sidebar control | differs | Avaliações is visible. |
| Source has no Categorias sidebar catalog control | differs | Categorias is visible. |
| Source has no partly visible Estoque sidebar control at bottom | differs | Top of Estoque is visible above the fixture disclosure. |
| Source has no top breadcrumb Diário / Agendamentos | differs | Breadcrumb is visible above the board. |
| Source has no background Horário de Brasília heading | differs | Horário de Brasília is above the board filters. |
| Source has no Consultar serviços para filtrar control | differs | This control is visible below the board filters. |
| Source has no Kanban / Lista view controls | differs | Kanban and Lista controls are visible below the filters. |
| Drawer header eyebrow Atendimento | same | Exact label retained. |
| Drawer Novo agendamento heading | same | Exact heading retained. |
| Escolha o cliente, o serviço e um horário. A disponibilidade e os valores são conferidos pelo sistema. | same | Exact two-line description retained. |
| Top-right square close control with × | same | Same visible close control. |
| Horizontal rule under fixed drawer header | same | Same fixed-header divider. |
| Visible end of professional selector showing Camila Andrade directly under header | differs | A full select row showing Ana · manual local is visible; the source shows only the lower part of its selector. |
| Data e horário section heading with clock icon and horizontal rule | same | Same heading, icon and line, about 22px lower in the running body scroll position. |
| Horário de Brasília read-only label | same | Exact label retained; no editable timezone. |
| Informar horário avulso label and off switch at right | same | Same label and off state. |
| Consultar a partir de label and date input with calendar icon | same | Same control; current fixture date 07/12/2026 instead of 01/01/2030. |
| Consultar até label and date input with calendar icon | same | Same control; current fixture date 07/12/2026 instead of 03/01/2030. |
| Two query date controls on one row | same | Same side-by-side arrangement. |
| Full-width outlined Consultar datas button | same | Exact control retained. |
| Data disponível label and select value 02/01/2030 with chevron | same | Same control; selected current fixture day is 07/12/2026. |
| Horário disponível label and select value 10:00 with chevron | differs | Current fixture first real available slot is 08:00. |
| Separator above Resumo da seleção | same | Same horizontal rule. |
| Resumo da seleção heading | same | Exact heading retained. |
| Serviço row label | same | Exact label retained. |
| Service value Atendimento inicial | differs | Value is Consulta local manual local. |
| Profissional summary row label | same | Exact label retained. |
| Professional summary value Camila Andrade | differs | Value is Ana · manual local. |
| Duração cadastrada row label | same | Exact label retained. |
| Duration 30 min | same | Exact value retained. |
| Valor do serviço row label | same | Exact label retained. |
| Service price R$ 150,00 | differs | Current fixture price is R$ 50,00. |
| O horário e os valores serão conferidos ao criar o agendamento. | same | Exact sentence retained and fully visible above footer. |
| Summary labels left, values right in one two-column stack | same | Same arrangement; no overlap with sticky footer. |
| Fixed drawer footer separated by rule | same | Same fixed footer and divider. |
| Horário de Brasília · sem cobrança nesta tela footer sentence | same | Exact sentence retained. |
| Outlined Fechar button | same | Same control. |
| Green Criar agendamento button | same | Same enabled control, never submitted. |
| Footer actions at lower right, Fechar before Criar agendamento | same | Same arrangement; all summary and action bounds passed the original strict ratio=1 viewport assertions. |

### `captures/t79-approved-mobile-oneoff-summary.running.png`

| Element | Result | Picture draws |
| --- | --- | --- |
| 390×844 full-screen dark manual drawer | same | Same native mobile region and fixed header/footer arrangement. |
| Header eyebrow Atendimento | same | Exact label retained. |
| Novo agendamento heading | same | Exact heading retained. |
| Escolha o cliente, o serviço e um horário. A disponibilidade e os valores são conferidos pelo sistema. | same | Exact three-line description retained. |
| Top-right outlined square × close control | same | Same control. |
| Fixed-header bottom separator | same | Same line. |
| Source body starts directly with Data e hora em Brasília label | differs | A clipped green fragment of the enabled one-off switch is visible directly below the fixed header; the date label starts about 20px lower. |
| Data e hora em Brasília label | same | Exact label retained. |
| Focused date-time input with calendar icon and highlighted day segment | same | Same focused control, outlined ring, calendar icon and selected day segment; day follows current fixture. |
| Date-time input date 02/01/2030 | same | Date follows the fresh fixture: 07/12/2026. |
| Date-time input time 15:00 | differs | Time is 20:30 in the original one-off fixture. |
| Motivo do horário avulso (opcional) label | same | Exact label retained. |
| Empty large reason textarea with resize grip | same | Same empty control and grip. |
| O sistema conferirá sobreposições e a duração cadastrada do serviço. | same | Exact two-line helper sentence retained. |
| Separator above summary | same | Same rule; summary is about 20px lower in this body scroll position. |
| Resumo da seleção heading | same | Exact heading retained. |
| Serviço label | same | Exact label retained. |
| Service value Atendimento inicial | differs | Value is Consulta local manual local. |
| Profissional label | same | Exact label retained. |
| Professional value Camila Andrade | differs | Value is Ana · manual local. |
| Duração cadastrada label | same | Exact label retained. |
| Duration 30 min | same | Exact value retained. |
| Valor do serviço label | same | Exact label retained. |
| Price R$ 150,00 | differs | Current fixture price is R$ 50,00. |
| O horário e os valores serão conferidos ao criar o agendamento. | same | Exact two-line sentence retained and fully visible above footer. |
| Summary labels left and values right | same | Same two-column summary arrangement. |
| Fixed-footer top border | same | Same divider. |
| Horário de Brasília · sem cobrança nesta tela | same | Exact footer sentence retained. |
| Outlined Fechar button | same | Same lower-left control. |
| Green Criar agendamento button | same | Same enabled lower-right control; never submitted. |
| Footer actions arranged side-by-side at full mobile width | same | Same placement, all bounds visible under original strict ratio=1 assertions. |
