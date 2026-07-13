import { supabase } from "@/lib/supabase";
import AdminPasswordForm from "@/components/AdminPasswordForm";

export default async function AdminPasswordPage() {
  // 여기 오기 전에 admin layout 이 이미 관리자인지 확인했다.
  const { data } = await supabase
    .from("users")
    .select("id, username")
    .order("created_at", { ascending: true });

  return <AdminPasswordForm users={data ?? []} />;
}
