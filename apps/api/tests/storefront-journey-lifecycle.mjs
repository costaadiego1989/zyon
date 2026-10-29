import { z } from "zod";

export const journeyLifecycleEventSchema = z.strictObject({
  stage: z.enum(["scope", "search", "add", "options", "edit", "remove", "recovery", "phase",
    "bridge_dispose", "bindings_dispose", "redis_capture", "app_close", "redis_close", "prisma_close", "verifier_close", "fence_restore"]),
  event: z.enum(["start", "completed", "failed"]),
});
export function emitJourneyLifecycle(stage, event, write = line => process.stdout.write(`${line}\n`)) {
  const checked = journeyLifecycleEventSchema.parse({ stage, event });
  write(`JOURNEY_LIFECYCLE ${JSON.stringify(checked)}`);
}
export function parseJourneyLifecycleLine(line) {
  if (typeof line !== "string" || line.length > 512 || !line.startsWith("JOURNEY_LIFECYCLE ")) return undefined;
  try { const result = journeyLifecycleEventSchema.safeParse(JSON.parse(line.slice("JOURNEY_LIFECYCLE ".length)));
    return result.success ? result.data : undefined; } catch { return undefined; }
}
