import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, COOKIE_OPTIONS, signSession, verifySession } from "@/lib/session-token";

/**
 * 로그인 쿠키의 기한을 들를 때마다 새로 늘려 준다(sliding session).
 *
 * 예전엔 로그인할 때 딱 한 번 30일짜리 쿠키를 심고 끝이라, 30일이 지나면 쓰던 중에도
 * 로그아웃됐다. 특히 휴대폰은 브라우저를 며칠씩 안 닫고 두다가 어느 날 갑자기 풀렸다.
 * 이제 화면을 한 번 열 때마다 기한이 1년으로 되감기므로, 계속 쓰는 한 풀리지 않는다.
 */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return res;

  const session = await verifySession(token);
  if (!session) return res;

  res.cookies.set(COOKIE_NAME, await signSession(session), COOKIE_OPTIONS);
  return res;
}

export const config = {
  // 화면을 열 때만 되감으면 된다. 정적 파일과 API 요청까지 매번 서명할 일은 없다.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
