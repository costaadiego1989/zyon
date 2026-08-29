export interface ToolRequestContext {
  merchantId: string;
  sessionId: string;
  buyer?: {
    globalUserId: string;
    name?: string;
    phone?: string;
    email?: string;
  };
}
