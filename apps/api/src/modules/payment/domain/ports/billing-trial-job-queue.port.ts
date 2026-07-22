export const BILLING_TRIAL_JOB_QUEUE = Symbol("BILLING_TRIAL_JOB_QUEUE");

export interface BillingTrialJobQueue {
  scheduleTrialExpiration(input: {
    merchantId: string;
    trialEndsAt: string;
  }): Promise<void>;
}
