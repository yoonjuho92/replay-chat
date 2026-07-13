import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import PasswordForm from "@/components/PasswordForm";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <PasswordForm username={session.username} />;
}
