import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/session";

const MIN_LENGTH = 4;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();

  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return NextResponse.json({ error: "비밀번호를 입력해주세요." }, { status: 400 });
  }
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `새 비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.` },
      { status: 400 },
    );
  }

  const { data: user } = await supabase
    .from("users")
    .select("id, password_hash")
    .eq("id", session.userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }

  // 쿠키만으로 바꾸게 두면 로그인된 기기를 잠깐 빌린 사람도 비밀번호를 바꿔버릴 수 있다.
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) {
    return NextResponse.json(
      { error: "지금 쓰는 비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  const { error } = await supabase
    .from("users")
    .update({ password_hash: await bcrypt.hash(newPassword, 10) })
    .eq("id", session.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
