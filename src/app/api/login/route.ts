import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { createSession } from "@/lib/session";

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id, username, password_hash")
    .eq("username", username.trim())
    .maybeSingle();

  // 존재하지 않는 아이디와 틀린 비밀번호를 같은 메시지로 처리해 계정 존재 여부가 새지 않게 한다.
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !ok) {
    return NextResponse.json(
      { error: "아이디 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 },
    );
  }

  await createSession({ userId: user.id, username: user.username });
  return NextResponse.json({ ok: true });
}
