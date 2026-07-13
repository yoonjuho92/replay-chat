import { guardAdmin } from "@/lib/admin";
import PasswordForm from "@/components/PasswordForm";

export default async function AdminPasswordPage() {
  // 여기 오기 전에 layout 이 이미 관리자인지 확인했다.
  const guard = await guardAdmin();

  return <PasswordForm username={guard.ok ? guard.username : ""} />;
}
