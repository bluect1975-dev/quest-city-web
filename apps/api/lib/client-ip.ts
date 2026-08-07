/**
 * Extracts the client IP for rate-limiting purposes. `X-Forwarded-For` is
 * set by the Nginx reverse proxy in front of every environment this app
 * runs in (infrastructure/reverse-proxy/nginx.conf: `proxy_set_header
 * X-Forwarded-For $proxy_add_x_forwarded_for`) — the leftmost entry is the
 * original client. Falls back to a fixed bucket key when absent (e.g.
 * local `next dev` without the proxy in front), which intentionally rate
 * limits all such direct-to-API traffic as a single IP rather than
 * silently disabling the IP dimension.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    const trimmed = first?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "unknown";
}
