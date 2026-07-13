import { NextResponse } from "next/server";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { supabase, signImage } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { openai, CHAT_MODEL, SYSTEM_PROMPT } from "@/lib/openai";

// 자서전 한 편이 3000-5000자라 생성이 길다. 기본 제한으로는 잘린다.
export const maxDuration = 300;

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0];
  if (!line) return "새 대화";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const text: string = typeof body.text === "string" ? body.text.trim() : "";
  const attachmentIds: string[] = Array.isArray(body.attachmentIds) ? body.attachmentIds : [];
  let conversationId: string | null = body.conversationId ?? null;

  if (!text && attachmentIds.length === 0) {
    return NextResponse.json({ error: "보낼 내용이 없습니다." }, { status: 400 });
  }

  if (conversationId) {
    const { data: owned } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!owned) {
      return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
    }
  } else {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: session.userId, title: titleFrom(text) })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "대화 생성 실패" }, { status: 500 });
    }
    conversationId = data.id;
  }

  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content: text })
    .select("id")
    .single();

  if (userMessageError || !userMessage) {
    return NextResponse.json(
      { error: userMessageError?.message ?? "메시지 저장 실패" },
      { status: 500 },
    );
  }

  // 방금 올린(아직 메시지에 안 붙은) 첨부만 이 메시지에 연결한다.
  if (attachmentIds.length > 0) {
    await supabase
      .from("attachments")
      .update({ message_id: userMessage.id, conversation_id: conversationId })
      .in("id", attachmentIds)
      .eq("user_id", session.userId)
      .is("message_id", null);
  }

  const { data: history } = await supabase
    .from("messages")
    .select("id, role, content, created_at, attachments(storage_path)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const input: ResponseInputItem[] = [];
  for (const message of history ?? []) {
    if (message.role === "assistant") {
      input.push({ role: "assistant", content: message.content });
      continue;
    }

    const content: ResponseInputItem.Message["content"] = [];
    if (message.content) content.push({ type: "input_text", text: message.content });

    for (const attachment of message.attachments ?? []) {
      // 버킷이 private 이라 OpenAI 가 직접 못 읽는다. 짧게 유효한 서명 URL 을 넘긴다.
      const url = await signImage(attachment.storage_path, 60 * 10);
      if (url) content.push({ type: "input_image", image_url: url, detail: "auto" });
    }

    if (content.length > 0) input.push({ role: "user", content });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("start", { conversationId, userMessageId: userMessage.id });

      let answer = "";
      try {
        const events = await openai.responses.create({
          model: CHAT_MODEL,
          instructions: SYSTEM_PROMPT,
          input,
          stream: true,
        });

        for await (const event of events) {
          if (event.type === "response.output_text.delta") {
            answer += event.delta;
            send("delta", { text: event.delta });
          } else if (event.type === "response.failed" || event.type === "error") {
            throw new Error("모델 응답이 실패했습니다.");
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "응답 생성에 실패했습니다.";
        send("error", { message });
        controller.close();
        return;
      }

      // 스트림이 끊겨 클라이언트가 못 받았더라도 답변은 DB 에 남는다.
      const { data: saved } = await supabase
        .from("messages")
        .insert({ conversation_id: conversationId, role: "assistant", content: answer })
        .select("id")
        .single();

      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      send("done", { messageId: saved?.id ?? null });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
