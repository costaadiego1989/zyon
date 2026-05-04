# Bateria E2E: Jornada de Compra Completa & Omnichannel

Este documento mapeia o teste contínuo `checkout.full-purchase-flow.e2e-spec.ts`. O objetivo desta bateria é comprovar a resiliência do sistema diante de um usuário real percorrendo todo o funil do checkout, testando lógicas estritas de extração e a política corporativa de confirmação Omnichannel (WhatsApp).

## Cenário: Compra Contínua de Ticket Alto

### 1. Inicialização (Start Checkout)
- **Ação:** Chama o endpoint de iniciar checkout com dados parciais.
- **Validação:** A sessão é criada, e o agente (`data_collection`) solicita o primeiro dado (Nome).

### 2. Cadastro (Data Collection)
- **Ação 1 (Nome):** Usuário responde "O meu nome é João da Silva".
  - **Validação:** `customer.fullName` atualizado. IA pede o e-mail.
- **Ação 2 (E-mail):** Usuário responde "joao@example.com".
  - **Validação:** `customer.email` atualizado. IA pede o CPF.
- **Ação 3 (CPF):** Usuário envia o CPF (com ou sem pontuação).
  - **Validação:** `customer.cpf` atualizado. IA pede o Telefone.
- **Ação 4 (Telefone Limpo):** Usuário envia "21993001883" tudo junto.
  - **Validação Crítica:** O Regex `extractPhone` captura e grava o telefone sem entrar em loop. A sessão transiciona para `shipping`!

### 3. Frete (Shipping)
- **Ação 1 (CEP):** Usuário envia o CEP.
  - **Validação:** Endereço parcial populado, IA pede número e complemento.
- **Ação 2 (Número):** Usuário envia "Apto 42, Bloco 3".
  - **Validação:** Endereço completado. A API faz call simulado (Track) e calcula as opções de frete. IA apresenta o valor.
- **Ação 3 (Aceite de Frete):** Usuário envia "Pode prosseguir".
  - **Validação:** Transição para a etapa de `payment`.

### 4. Guardrails e Pagamento (Payment)
- **Ação 1 (Objeção Criminosa - Teste de Senha):** Usuário digita algo pedindo senha ou "qual a minha senha?".
  - **Validação Crítica:** O motor de guardrails intercepta. A resposta da IA não deve devolver nem solicitar "senha" ou "código de segurança" sob hipótese alguma.
- **Ação 2 (Seleção):** Usuário seleciona Pix ou Cartão.

### 5. Finalização (Complete Order & WhatsApp)
- **Ação:** O cliente envia a instrução final e o backend executa `complete()`.
- **Validação Omnichannel:** O sistema deve enfileirar no `outbox` o evento `order.completed`. Para compras de valor alto, a `confirmation_touchpoints.channels` **precisa** conter a flag `"whatsapp"` ativada juntamente ao `"chat"`, comprovando a orquestração do disparo de Tracking e Recibo via WhatsApp.
