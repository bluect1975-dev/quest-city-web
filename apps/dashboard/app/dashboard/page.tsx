import { StatusMessage } from "@quest-city-web/ui";

/**
 * WEB-M0 controlled placeholder (deliverable 11). `/dashboard` is the
 * external reverse-proxy path for this app (07_06 §3 topology). The
 * canonical screen-by-screen IA for the school/teacher dashboard is
 * registered separately in 02_23 §7 under a single shared route root,
 * `/app` — that IA is not implemented yet and is intentionally out of
 * scope here. This placeholder must not be mistaken for a second,
 * competing dashboard: there is exactly one dashboard product, shared by
 * school and teacher roles, per 02_16 / 02_23.
 */
export default function DashboardPlaceholderPage() {
  return (
    <main>
      <h1>Quest City Dashboard</h1>
      <StatusMessage kind="empty">
        The shared school/teacher dashboard is under construction. This placeholder confirms the{" "}
        <code>/dashboard</code> route is live end-to-end. The eventual screen IA (02_23) will live
        under <code>/app</code> within this same application — not as a separate dashboard.
      </StatusMessage>
    </main>
  );
}
