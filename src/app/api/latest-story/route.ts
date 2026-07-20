import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { latestStoryFor } from "@/lib/latest-story";

/**
 * 새 대화 첫 화면에서, 안내 문구 대신 띄울 가장 최근 이야기를 돌려준다.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const story = await latestStoryFor(session.userId);
  return NextResponse.json({ story });
}
