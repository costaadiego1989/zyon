export type SupportPanelModel = {
  open: boolean;
  apiOrigin: string;
  merchantId: string;
  sessionId?: string;
  globalUserId?: string;
  embedToken?: string;
  brandName: string;
  onClose: () => void;
};
