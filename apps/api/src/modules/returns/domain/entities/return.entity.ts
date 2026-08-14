export type ReturnStatus =
  | "REQUESTED"
  | "LABEL_GENERATED"
  | "SHIPPED"
  | "RECEIVED"
  | "INSPECTED_PASS"
  | "INSPECTED_FAIL"
  | "REFUND_PROCESSING"
  | "REFUND_COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export type ReturnReason =
  | "DEFECTIVE"
  | "WRONG_ITEM"
  | "NOT_AS_DESCRIBED"
  | "CHANGED_MIND"
  | "DAMAGED_IN_TRANSIT"
  | "OTHER";

export type ItemCondition = "NEW" | "GOOD" | "DAMAGED" | "UNUSABLE";

export interface ReturnItemProps {
  id: string;
  returnId: string;
  variantId: string;
  quantity: number;
  reason?: string;
}

export interface ReturnLabelProps {
  id: string;
  returnId: string;
  carrier: string;
  trackingNumber: string;
  labelUrl?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ReturnInspectionProps {
  id: string;
  returnId: string;
  inspectedBy: string;
  itemCondition: ItemCondition;
  verdict: string;
  notes?: string;
  inspectedAt: Date;
}

export interface ReturnRefundProps {
  id: string;
  returnId: string;
  paymentIntentId?: string;
  amountInCents: number;
  status: string;
  processedAt?: Date;
  createdAt: Date;
}

export interface ReturnProps {
  id: string;
  merchantId: string;
  orderId: string;
  buyerId: string;
  reason: ReturnReason;
  notes?: string;
  status: ReturnStatus;
  createdAt: Date;
  updatedAt: Date;
  items: ReturnItemProps[];
  label?: ReturnLabelProps;
  inspection?: ReturnInspectionProps;
  refund?: ReturnRefundProps;
}

export class ReturnEntity {
  readonly id: string;
  readonly merchantId: string;
  readonly orderId: string;
  readonly buyerId: string;
  readonly reason: ReturnReason;
  readonly notes?: string;
  readonly status: ReturnStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: ReturnItemProps[];
  readonly label?: ReturnLabelProps;
  readonly inspection?: ReturnInspectionProps;
  readonly refund?: ReturnRefundProps;

  constructor(props: ReturnProps) {
    this.id = props.id;
    this.merchantId = props.merchantId;
    this.orderId = props.orderId;
    this.buyerId = props.buyerId;
    this.reason = props.reason;
    this.notes = props.notes;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.items = props.items;
    this.label = props.label;
    this.inspection = props.inspection;
    this.refund = props.refund;
  }

  get canGenerateLabel(): boolean {
    return this.status === "REQUESTED";
  }

  get canMarkReceived(): boolean {
    return this.status === "LABEL_GENERATED" || this.status === "SHIPPED";
  }

  get canInspect(): boolean {
    return this.status === "RECEIVED";
  }

  get canRefund(): boolean {
    return this.status === "INSPECTED_PASS";
  }

  get canRestock(): boolean {
    return this.status === "REFUND_COMPLETED" || this.status === "INSPECTED_PASS";
  }

  get canCancel(): boolean {
    return this.status === "REQUESTED" || this.status === "LABEL_GENERATED";
  }
}
