export const IMPORT_QUEUE = Symbol("ImportQueuePort");

export interface ImportQueuePort {
  enqueue(jobId: string, merchantId: string): Promise<void>;
}
