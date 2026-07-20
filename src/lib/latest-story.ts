import "server-only";
import { supabase } from "./supabase";
import { extractStories } from "./story";

/**
 * 이 사용자가 지금까지 남긴 이야기 중 가장 최근의 <story> 본문 하나.
 * 새 대화를 열면 이 이야기를 첫 메시지로 앉힌다. 없으면 null.
 */
export async function latestStoryFor(userId: string): Promise<string | null> {
  // 내 대화에 담긴, <story> 를 품은 답변만 최신순으로 몇 개 훑는다.
  const { data } = await supabase
    .from("messages")
    .select("content, conversations!inner(user_id)")
    .eq("role", "assistant")
    .eq("conversations.user_id", userId)
    .ilike("content", "%<story>%")
    .order("created_at", { ascending: false })
    .limit(20);

  for (const message of data ?? []) {
    const stories = extractStories(message.content);
    // 한 답변에 이야기가 여럿이면 마지막(가장 다듬어진) 것을 쓴다.
    if (stories.length > 0) return stories.at(-1) ?? null;
  }

  return null;
}
