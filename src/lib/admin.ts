import { getSession } from "./session";

/** /admin 에 들어올 수 있는 사람. */
const ADMINS = ["윤주호"];

export type AdminGuard =
  | { ok: true; username: string }
  | { ok: false; reason: "anonymous" | "forbidden" };

export async function guardAdmin(): Promise<AdminGuard> {
  const session = await getSession();

  if (!session) return { ok: false, reason: "anonymous" };
  if (!ADMINS.includes(session.username)) return { ok: false, reason: "forbidden" };

  return { ok: true, username: session.username };
}
