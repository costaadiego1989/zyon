export const MARKETING_CLASSIFIER = Symbol("MARKETING_CLASSIFIER");
export interface MarketingInterest {
  evidence: string;
  interests: string[];
}
export interface MarketingClassifier {
  classify(input: {
    merchantId: string;
    conversationId: string;
    messageId: string;
    text: string;
  }): Promise<MarketingInterest | null>;
}
