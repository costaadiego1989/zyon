# Spec: Human Handoff — Live Chat Suporte

## Context

Quando buyer pede "falar com humano" no chat (widget ou storefront), o agente deve escalar para atendimento humano. O merchant recebe o ticket em tempo real no dashboard e responde via drawer lateral. A resposta aparece inline no chat do buyer.

## Requirements

### R1: Criar ticket real no escalate_to_human
- Storefront tool `escalate_to_human` deve chamar `SupportHandoffService` (não mais fake ID)
- Widget chat já tem detecção via regex — manter, mas garantir ticket é criado

### R2: Modelo SupportTicketMessage
- Novo model Prisma para thread de mensagens do ticket
- Campos: id, ticketId, senderType ("buyer"|"merchant"), content, createdAt
- Permite back-and-forth entre buyer e merchant

### R3: API de reply
- `POST /support/tickets/:id/messages` — merchant envia mensagem
- `GET /support/tickets/:id/messages` — lista thread
- Buyer envia via socket (message no room do ticket)

### R4: WebSocket para merchant
- Novo namespace `/support` no gateway ou reuso do existente
- Merchant join room do ticket ao abrir drawer
- Eventos: `new_ticket`, `new_message`, `ticket_status_changed`
- Buyer recebe `merchant_message` no room da conversa

### R5: Drawer lateral no dashboard
- Componente `SupportChatDrawer` — abre ao clicar em ticket
- Mostra: buyerMessage inicial + thread de mensagens
- Campo de input + botão enviar
- Status badge + ações (resolver, fechar)
- WebSocket conectado — mensagens aparecem em tempo real

### R6: Resposta no widget/storefront
- Quando merchant responde, mensagem chega via WebSocket no room da conversa
- Widget/storefront renderiza como mensagem do "atendente" (diferente do agente IA)
- Badge visual "Atendente" ao invés de "Zyon"

### R7: Notificação de novo ticket
- Dashboard recebe evento `new_ticket` via WebSocket
- Badge/counter na nav de suporte
- Toast notification opcional

## Non-goals (v1)
- WhatsApp/email notification (futuro)
- Transfer back to AI after resolution
- Typing indicators
- File attachments
- Sound notifications

## Acceptance Criteria
1. Buyer diz "quero falar com humano" → ticket criado no banco
2. Dashboard mostra ticket em tempo real (sem refresh)
3. Merchant abre drawer → vê mensagem do buyer
4. Merchant responde → buyer vê mensagem no chat
5. Buyer responde → merchant vê no drawer em tempo real
6. Merchant muda status → ticket atualizado
