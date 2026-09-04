export const NPS_REPOSITORY = Symbol("NPS_REPOSITORY");

export interface NpsResponse {
  id: string;
  merchantId: string;
  buyerId: string;
  orderId: string | null;
  score: number; // 0-10
  feedback: string | null;
  classification: "promoter" | "passive" | "detractor";
  createdAt: Date;
}

export interface CreateNpsResponseInput {
  merchantId: string;
  buyerId: string;
  orderId?: string;
  score: number;
  feedback?: string;
}

export interface NpsRepositoryPort {
  create(input: CreateNpsResponseInput): Promise<NpsResponse>;
  findById(merchantId: string, id: string): Promise<NpsResponse | null>;
  listByMerchant(
    merchantId: string,
    page?: number,
    pageSize?: number
  ): Promise<{ items: NpsResponse[]; total: number }>;
  countByClassification(
    merchantId: string,
    classification: "promoter" | "passive" | "detractor"
  ): Promise<number>;
  averageScore(merchantId: string): Promise<number | null>;
}
