export type OmnichannelConfirmationPlan = {
  channels: Array<"chat" | "whatsapp">;
  whatsapp_ack_recommended: boolean;
};

export const OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL = 500;

export function planOmnichannelConfirmation(orderTotalBrl: number): OmnichannelConfirmationPlan {
  if (orderTotalBrl >= OMNICHANNEL_WHATSAPP_TOTAL_THRESHOLD_BRL) {
    return {
      channels: ["chat", "whatsapp"],
      whatsapp_ack_recommended: true
    };
  }
  return {
    channels: ["chat"],
    whatsapp_ack_recommended: false
  };
}
