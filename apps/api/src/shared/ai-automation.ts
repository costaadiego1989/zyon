import { withAiMetering, type AiMeteringContext } from "./ai-metering.js";
type TaskContext = AiMeteringContext & { taskType: string };
export interface AiAutomationSink {
  beginTask(context: TaskContext): Promise<{id:string}>;
  finishTask(id: string, status: "succeeded" | "failed"): Promise<void>;
}
let sink: AiAutomationSink | undefined;
export function configureAiAutomation(value: AiAutomationSink) { sink = value; return () => { if(sink === value) sink = undefined; }; }
/** Task boundaries, never individual model attempts. No prompt or output is retained. */
export async function withAiAutomation<T>(context: TaskContext, work: () => Promise<T>): Promise<T> {
  const target = sink;
  if (!target) {
    if (process.env.NODE_ENV === "production") throw new Error("ai_automation_not_initialized");
    return withAiMetering(context, work);
  }
  const task = await target.beginTask(context);
  let result: T;
  try { result = await withAiMetering({...context,taskId:task.id},work); }
  catch(error) { await target.finishTask(task.id,"failed"); throw error; }
  // Completion recording must never cause a second execution of the paid task.
  await target.finishTask(task.id,"succeeded");
  return result;
}
