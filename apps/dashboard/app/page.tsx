import { redirect } from "next/navigation";

export default function RootIndexPage() {
  redirect("/dashboard");
}
