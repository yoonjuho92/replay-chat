import "server-only";
import { supabase } from "./supabase";
import { storyBlocks } from "./story";

export type StoryLocation = { messageId: string; index: number; text: string };

/**
 * 이 사용자가 지금까지 남긴 이야기 중 가장 최근의 <story> 블록이 어디 있는지.
 * 새 대화 첫 메시지도, 관리자가 고치는 대상도 모두 이 한 블록이라, 둘이 어긋나지 않게
 * 위치(messageId·index)까지 한곳에서 정한다. 없으면 null.
 */
export async function latestStoryLocation(userId: string): Promise<StoryLocation | null> {
  // 내 대화에 담긴, <story> 를 품은 답변만 최신순으로 몇 개 훑는다.
  const { data } = await supabase
    .from("messages")
    .select("id, content, conversations!inner(user_id)")
    .eq("role", "assistant")
    .eq("conversations.user_id", userId)
    .ilike("content", "%<story>%")
    .order("created_at", { ascending: false })
    .limit(20);

  for (const message of data ?? []) {
    // 한 답변에 이야기가 여럿이면 마지막(가장 다듬어진) 것을 쓴다.
    const blocks = storyBlocks(message.content).filter((b) => b.text.trim());
    const last = blocks.at(-1);
    if (last) return { messageId: message.id, index: last.index, text: last.text.trim() };
  }

  return null;
}

/** 가장 최근 이야기의 본문. 새 대화 첫 화면·첫 메시지에 쓴다. */
export async function latestStoryFor(userId: string): Promise<string | null> {
  return (await latestStoryLocation(userId))?.text ?? null;
}
