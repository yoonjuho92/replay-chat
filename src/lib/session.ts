import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  signSession,
  verifySession,
  type Session,
} from "./session-token";

export type { Session };

export async function createSession(session: Session) {
  const store = await cookies();
  store.set(COOKIE_NAME, await signSession(session), COOKIE_OPTIONS);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function destroySession() {
  (await cookies()).delete(COOKIE_NAME);
}
