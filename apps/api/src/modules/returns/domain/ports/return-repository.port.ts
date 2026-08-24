import { ReturnEntity, ReturnStatus, ReturnItemProps, ReturnLabelProps, ReturnInspectionProps, ReturnRefundProps } from "../entities/return.entity.js";

export interface CreateReturnInput {
  merchantId: string;
  orderId: string;
  buyerId: string;
  reason: string;
  notes?: string;
  items: Array<{ variantId: string; quantity: number; reason?: string }>;
}

export interface ListReturnsInput {
  merchantId: string;
  status?: ReturnStatus;
  limit?: number;
  cursor?: string;
}

export interface ListReturnsResult {
  returns: ReturnEntity[];
  nextCursor?: string;
  total: number;
}

export interface SaveLabelInput {
  returnId: string;
  carrier: string;
  trackingNumber: string;
  labelUrl?: string;
  expiresAt: Date;
}

export interface SaveInspectionInput {
  returnId: string;
  inspectedBy: string;
  itemCondition: string;
  verdict: string;
  notes?: string;
}

export interface SaveRefundInput {
  returnId: string;
  paymentIntentId?: string;
  amountInCents: number;
  status: string;
}

export const RETURN_REPOSITORY_PORT = "ReturnRepositoryPort";

export interface ReturnRepositoryPort {
  create(input: CreateReturnInput): Promise<ReturnEntity>;
  findById(merchantId: string, returnId: string): Promise<ReturnEntity | null>;
  findByOrderId(merchantId: string, orderId: string): Promise<ReturnEntity[]>;
  findByBuyerId(buyerId: string): Promise<ReturnEntity[]>;
  list(input: ListReturnsInput): Promise<ListReturnsResult>;
  updateStatus(returnId: string, status: ReturnStatus): Promise<void>;
  saveLabel(input: SaveLabelInput): Promise<ReturnLabelProps>;
  saveInspection(input: SaveInspectionInput): Promise<ReturnInspectionProps>;
  saveRefund(input: SaveRefundInput): Promise<ReturnRefundProps>;
  updateRefundStatus(returnId: string, status: string, processedAt?: Date): Promise<void>;
}
