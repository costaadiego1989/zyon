import { z } from "zod";

const uuid = z.uuidv4();
// Canonical StartStoreConversationUseCase prefixes its random UUID with conv_.
// Preserve existing UUID-only synthetic contracts, never arbitrary resource IDs.
const conversationId = z.union([uuid, z.string().max(41).refine(value => value.startsWith("conv_") && uuid.safeParse(value.slice(5)).success)]);
const manifestSchema = z.strictObject({ version: z.literal(1), runId: uuid, apiOrigin: z.string(),
  merchantId: uuid, buyerId: uuid, sessionId: conversationId,
  postgresRunId: uuid, redisRunId: uuid, postgresPort: z.number().int().min(1025).max(65535), redisPort: z.number().int().min(1025).max(65535),
}).superRefine((value, ctx) => {
  try {
    const url = new URL(value.apiOrigin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== value.apiOrigin
      || Number(url.port) <= 1024 || Number(url.port) > 65535 || url.username || url.password
      || new Set([value.merchantId, value.buyerId, value.sessionId]).size !== 3
      || new Set([Number(url.port), value.postgresPort, value.redisPort]).size !== 3) throw new Error();
  } catch { ctx.addIssue({ code: "custom", message: "invalid_run_destination" }); }
});
const principalSchema = z.strictObject({ runId: uuid, merchantId: uuid, buyerId: uuid, sessionId: conversationId });
const resourcesSchema = principalSchema.extend({ apiOrigin: z.string(), postgresRunId: uuid, redisRunId: uuid,
  postgresPort: z.number().int(), redisPort: z.number().int() });
const capabilities = new WeakMap();
const fail = code => { throw new Error(code); };
function parsed(schema, input, code) {
  try { const result = schema.safeParse(input); if (result.success) return structuredClone(result.data); } catch {}
  return fail(code);
}
/** Structure only, no capability or authentication grant. */
export function parseJourneyManifest(input) {
  return parsed(manifestSchema, input, "journey_manifest_invalid");
}
function equalPrincipal(expected, actual, code) {
  for (const name of ["runId", "merchantId", "buyerId", "sessionId"]) if (actual[name] !== expected[name]) return fail(code);
}
async function assertResources(record) {
  let result;
  try { result = await record.verifyResources(structuredClone(record.manifest)); }
  catch { return fail("journey_resource_verification_failed"); }
  const owned = parsed(resourcesSchema, result, "journey_resources_invalid");
  equalPrincipal(record.manifest, owned, "journey_resources_mismatch");
  for (const key of ["apiOrigin", "postgresRunId", "redisRunId", "postgresPort", "redisPort"])
    if (owned[key] !== record.manifest[key]) return fail("journey_resources_mismatch");
}
async function assertPrincipal(record) {
  let claims;
  try { claims = await record.verifyPrincipal(record.principalToken, structuredClone(record.manifest)); }
  catch { return fail("journey_principal_verification_failed"); }
  const verified = parsed(principalSchema, claims, "journey_principal_invalid");
  equalPrincipal(record.manifest, verified, "journey_principal_mismatch");
}

/** The verifier ports must be wired to canonical authentication and live owned
 * run markers by the future runner. Test doubles do NOT prove either property.
 * No permissive default or direct body-to-capability constructor is provided. */
export async function verifyJourneyPreflight(input) {
  const manifest = parsed(manifestSchema, input?.manifest, "journey_manifest_invalid");
  if (typeof input?.verifyPrincipal !== "function" || typeof input?.verifyResources !== "function"
    || typeof input?.principalToken !== "string" || !input.principalToken.length
    || Object.keys(input).some(key => !["manifest", "principalToken", "verifyPrincipal", "verifyResources"].includes(key))) {
    return fail("journey_verifiers_required");
  }
  const record = { manifest, verifyResources: input.verifyResources,
    verifyPrincipal: input.verifyPrincipal, principalToken: input.principalToken };
  await assertPrincipal(record);
  await assertResources(record);
  const capability = Object.freeze({}); capabilities.set(capability, record);
  return capability;
}

export function readJourneyCapability(capability) {
  const record = capability && capabilities.get(capability);
  if (!record) return fail("journey_capability_required");
  return structuredClone(record.manifest);
}
export async function revalidateJourneyCapability(capability) {
  readJourneyCapability(capability);
  await assertPrincipal(capabilities.get(capability));
  await assertResources(capabilities.get(capability));
}
