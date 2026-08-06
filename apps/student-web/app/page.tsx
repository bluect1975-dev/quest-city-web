import { redirect } from "next/navigation";

/**
 * 07_03 §4: "/w" is the canonical Web root namespace, chosen precisely to
 * avoid colliding with the dashboard, API and public site. The bare origin
 * root simply forwards there.
 */
export default function RootIndexPage() {
  redirect("/w");
}
