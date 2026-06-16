export type BuyerGuestModalModel = {
  open: boolean;
  firstName?: string;
  checkoutEmail?: string;
  emailConfirmed: boolean;
  onClose: () => void;
  onLogin: () => void;
};
