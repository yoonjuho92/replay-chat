import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { guardAdmin } from "@/lib/admin";

const MIN_LENGTH = 4;

/**
 * 관리자가 아무 사용자의 비밀번호나 새로 정한다. 지금 쓰는 비밀번호는 묻지 않는다.
 * 그래서 이 라우트는 관리자인지부터 확인해야 한다.
 */
export async function POST(req: Request) {
  const guard = await guardAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason === "anonymous" ? "인증이 필요합니다." : "권한이 없습니다." },
      { status: guard.reason === "anonymous" ? 401 : 403 },
    );
  }

  const { userId, newPassword } = await req.json();

  if (typeof userId !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "사용자와 새 비밀번호를 골라주세요." }, { status: 400 });
  }
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `새 비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.` },
      { status: 400 },
    );
  }

  const { data: user } = await supabase
    .from("users")
    .select("id, username")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "그런 사용자가 없습니다." }, { status: 404 });
  }

  const { error } = await supabase
    .from("users")
    .update({ password_hash: await bcrypt.hash(newPassword, 10) })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, username: user.username });
}
