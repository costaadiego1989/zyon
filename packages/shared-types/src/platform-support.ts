export const PLATFORM_SUPPORT_STATUSES = ["open", "in_progress", "waiting_customer", "resolved"] as const;
export const PLATFORM_SUPPORT_SEVERITIES = ["normal", "high", "critical"] as const;
export type PlatformSupportStatus = typeof PLATFORM_SUPPORT_STATUSES[number];
export type PlatformSupportSeverity = typeof PLATFORM_SUPPORT_SEVERITIES[number];
export type PlatformSupportCategory = "bug" | "improvement" | "suggestion" | "other";
export type PlatformSupportTier = "standard" | "priority";

export interface PlatformSupportCapabilities {
  canOpen: boolean;
  tier: PlatformSupportTier;
  plan: string;
  availability: string;
  agingHours: number;
}

export interface PlatformSupportTicket {
  id: string;
  merchantId: string;
  merchantName: string;
  subject: string;
  category: PlatformSupportCategory;
  status: PlatformSupportStatus;
  severity: PlatformSupportSeverity;
  tier: PlatformSupportTier;
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  createdAt: string;
  updatedAt: string;
  waitingSince: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  lastMessageSequence: number;
  unreadCount: number;
}

export interface PlatformSupportMessage {
  id: string;
  ticketId: string;
  sequence: number;
  sender: "merchant" | "operator";
  senderName: string;
  content: string;
  clientMessageId: string;
  createdAt: string;
}

export interface PlatformSupportNote {
  id: string;
  operatorId: string;
  content: string;
  createdAt: string;
}

export interface PlatformSupportConversation {
  ticket: PlatformSupportTicket;
  messages: PlatformSupportMessage[];
  hasMore: boolean;
  peerReadSequence: number;
}

export interface PlatformSupportPage {
  items: PlatformSupportTicket[];
  nextCursor: string | null;
}

export interface CreatePlatformSupportTicket {
  subject: string;
  category: PlatformSupportCategory;
  content: string;
  clientRequestId: string;
}

export interface SendPlatformSupportMessage {
  content: string;
  clientMessageId: string;
}

export interface PlatformSupportQuery {
  status?: PlatformSupportStatus;
  search?: string;
  mine?: boolean;
  cursor?: string;
}
