export type SupportPanelModel = {
  open: boolean;
  apiOrigin: string;
  merchantId: string;
  sessionId?: string;
  brandName: string;
  onClose: () => void;
};
