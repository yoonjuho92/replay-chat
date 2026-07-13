import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL 이 설정되지 않았습니다.");
if (!secretKey) {
  throw new Error(
    "SUPABASE_SECRET_KEY 가 설정되지 않았습니다. Supabase 대시보드 > Project Settings > API Keys 에서 secret key 를 복사해 .env.local 에 넣어주세요.",
  );
}

/**
 * RLS 를 우회하는 서버 전용 클라이언트. 서버 컴포넌트/route handler 밖에서
 * import 되면 secret key 가 번들에 섞일 수 있으므로 주의.
 */
export const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const IMAGE_BUCKET = "chat-images";

export async function signImage(path: string, expiresIn = 60 * 60) {
  const { data } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}
