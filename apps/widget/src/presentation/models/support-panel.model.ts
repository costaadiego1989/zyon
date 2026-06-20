export type SupportPanelModel = {
  open: boolean;
  apiOrigin: string;
  merchantId: string;
  sessionId?: string;
  embedToken?: string;
  brandName: string;
  onClose: () => void;
};
