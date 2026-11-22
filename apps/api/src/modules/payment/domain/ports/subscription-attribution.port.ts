export const SUBSCRIPTION_ATTRIBUTION=Symbol("SubscriptionAttribution");
export interface SubscriptionFinancialFact {
 provider:"stripe"|"asaas";eventId:string;state:"paid"|"refunded";subscriptionId:string;paymentRef:string;
 customerId:string;amountCents:number;occurredAt:Date;
}
export interface SubscriptionAttribution {
 tracksCustomer(provider:"stripe"|"asaas",customerId:string):Promise<boolean>;
 subscriptionForPayment(provider:"stripe"|"asaas",customerId:string,paymentRef:string):Promise<string|null>;
 observe(fact:SubscriptionFinancialFact):Promise<void>;
}
