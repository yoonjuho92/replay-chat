/**
 * 이야기 본문을 감싸는 태그. 이 파일은 클라이언트 번들에도 들어가므로
 * 서버 전용 모듈(openai, supabase)을 여기서 import 하면 안 된다.
 */
export const STORY_OPEN = "<story>";
export const STORY_CLOSE = "</story>";

export type Segment = { kind: "text" | "story"; text: string; open: boolean };

/**
 * 모델은 이야기 본문을 <story>…</story> 로 감싸서 보낸다.
 * 스트리밍 중에는 여는 태그만 온 상태가 있으므로, 닫히지 않은 이야기도 하나의 조각으로 본다.
 */
export function parseStory(content: string): Segment[] {
  const segments: Segment[] = [];
  let rest = content;

  while (rest.length > 0) {
    const start = rest.indexOf(STORY_OPEN);

    if (start === -1) {
      segments.push({ kind: "text", text: rest, open: false });
      break;
    }

    if (start > 0) segments.push({ kind: "text", text: rest.slice(0, start), open: false });
    rest = rest.slice(start + STORY_OPEN.length);

    const end = rest.indexOf(STORY_CLOSE);
    if (end === -1) {
      segments.push({ kind: "story", text: rest, open: true });
      break;
    }

    segments.push({ kind: "story", text: rest.slice(0, end), open: false });
    rest = rest.slice(end + STORY_CLOSE.length);
  }

  return segments.filter((s) => s.kind === "story" || s.text.trim().length > 0);
}

/** 한 답변에 담긴 이야기 본문만 뽑아낸다. */
export function extractStories(content: string) {
  return parseStory(content)
    .filter((s) => s.kind === "story")
    .map((s) => s.text.trim())
    .filter(Boolean);
}
