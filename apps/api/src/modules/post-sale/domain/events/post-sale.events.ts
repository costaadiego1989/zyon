export interface PostSaleScheduleTriggeredEvent {
  type: "post_sale:schedule_triggered";
  merchantId: string;
  orderId: string;
  buyerId: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  productName?: string;
}

export interface ReviewSubmittedEvent {
  type: "post_sale:review_submitted";
  merchantId: string;
  reviewId: string;
  productId: string;
  buyerId: string;
  rating: number;
}

export interface NpsResponseSubmittedEvent {
  type: "post_sale:nps_submitted";
  merchantId: string;
  npsId: string;
  buyerId: string;
  score: number;
  classification: "promoter" | "passive" | "detractor";
}

export type PostSaleEvent =
  | PostSaleScheduleTriggeredEvent
  | ReviewSubmittedEvent
  | NpsResponseSubmittedEvent;
