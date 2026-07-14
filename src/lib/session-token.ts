import { SignJWT, jwtVerify } from "jose";

/**
 * 쿠키에 담기는 토큰 자체를 다루는 곳. next/headers 를 쓰지 않으므로
 * 서버 컴포넌트에서도, 프록시(구 미들웨어)에서도 쓸 수 있다.
 */
export const COOKIE_NAME = "session";

// 한 번 로그인하면 계속 로그인된 채로 두려는 것이라 길게 잡는다. 게다가 프록시가
// 들를 때마다 기한을 새로 늘려 주므로, 앱을 쓰는 동안에는 사실상 만료되지 않는다.
export const MAX_AGE = 60 * 60 * 24 * 365; // 1년

export type Session = { userId: string; username: string };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET 이 설정되지 않았습니다.");
  return new TextEncoder().encode(value);
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: MAX_AGE,
} as const;

export async function signSession(session: Session) {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: payload.userId as string, username: payload.username as string };
  } catch {
    return null;
  }
}
