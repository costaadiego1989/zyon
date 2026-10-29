// Scoped child-process test doubles. Never loaded by production scripts.
export async function resolve(specifier, context, nextResolve) {
  if (!context.parentURL?.endsWith("/src/main.ts")) return nextResolve(specifier, context);
  let source;
  if (specifier === "dotenv") source = `export const config = () => { (globalThis.__tracingProbe ??= []).push('env'); };`;
  if (specifier === "./shared/observability/tracing.js") source = `
    export const initTracing = async () => {
      if (JSON.stringify(globalThis.__tracingProbe) !== JSON.stringify(['env','env'])) throw new Error('environment_order');
      globalThis.__tracingProbe.push('trace');
    };
    export const shutdownTracing = async () => {};
  `;
  if (specifier === "./application-bootstrap.js") source = `
    if (globalThis.__tracingProbe?.at(-1) !== 'trace') throw new Error('application_loaded_before_tracing');
    globalThis.__tracingProbe.push('application_import');
    export const bootstrap = async () => { globalThis.__tracingProbe.push('application_start'); console.log(JSON.stringify(globalThis.__tracingProbe)); };
  `;
  return source === undefined ? nextResolve(specifier, context)
    : { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
}
