/** Preserve only the raw loopback authority normalized by NextURL. */
export function normalizedLoopbackRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const loopbackHost = url.port ? `127.0.0.1:${url.port}` : "127.0.0.1";
  if (url.hostname === "localhost" && request.headers.get("host") === loopbackHost) {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}
