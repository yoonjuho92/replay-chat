import { NextResponse } from "next/server";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { supabase, signImage, IMAGE_BUCKET } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { openai, CHAT_MODEL, IMAGE_MODEL, SYSTEM_PROMPT } from "@/lib/openai";

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

  // 버킷이 private 이라 OpenAI 가 URL 을 직접 못 읽는다. 짧게 유효한 서명 URL 을 넘긴다.
  const asImages = async (attachments: { storage_path: string }[]) => {
    const parts: ResponseInputItem.Message["content"] = [];
    for (const attachment of attachments) {
      const url = await signImage(attachment.storage_path, 60 * 10);
      if (url) parts.push({ type: "input_image", image_url: url, detail: "auto" });
    }
    return parts;
  };

  const input: ResponseInputItem[] = [];
  for (const message of history ?? []) {
    const attachments = message.attachments ?? [];

    if (message.role === "assistant") {
      input.push({ role: "assistant", content: message.content });

      // 전에 그린 그림을 다시 보여줘야 "그거 색만 바꿔줘" 같은 이어지는 요청을 받을 수 있다.
      if (attachments.length > 0) {
        input.push({
          role: "user",
          content: [
            { type: "input_text", text: "(바로 위 답변에서 네가 그린 그림이다.)" },
            ...(await asImages(attachments)),
          ],
        });
      }
      continue;
    }

    const content: ResponseInputItem.Message["content"] = [];
    if (message.content) content.push({ type: "input_text", text: message.content });
    content.push(...(await asImages(attachments)));

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
      const drawn: string[] = [];

      try {
        const events = await openai.responses.create({
          model: CHAT_MODEL,
          instructions: SYSTEM_PROMPT,
          input,
          // 대화에 올라온 사진이 그대로 참조 이미지가 된다. 모델이 필요할 때 알아서 부른다.
          tools: [{ type: "image_generation", model: IMAGE_MODEL, size: "auto", quality: "medium" }],
          stream: true,
        });

        for await (const event of events) {
          if (event.type === "response.output_text.delta") {
            answer += event.delta;
            send("delta", { text: event.delta });
          } else if (event.type === "response.output_text.done") {
            // 델타 없이 완성 텍스트만 오는 경우가 있어 비어 있을 때만 채운다.
            if (!answer) {
              answer = event.text;
              send("delta", { text: event.text });
            }
          } else if (event.type === "response.image_generation_call.generating") {
            send("drawing", {});
          } else if (
            event.type === "response.output_item.done" &&
            event.item.type === "image_generation_call" &&
            event.item.result
          ) {
            const path = `${session.userId}/gen-${crypto.randomUUID()}.png`;
            const { error } = await supabase.storage
              .from(IMAGE_BUCKET)
              .upload(path, Buffer.from(event.item.result, "base64"), {
                contentType: "image/png",
              });

            if (!error) {
              drawn.push(path);
              send("image", { url: await signImage(path) });
            }
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

      // 그린 그림도 그 답변에 매달아 둬야 다음에 대화를 열었을 때 같이 뜬다.
      if (saved && drawn.length > 0) {
        await supabase.from("attachments").insert(
          drawn.map((path) => ({
            message_id: saved.id,
            conversation_id: conversationId,
            user_id: session.userId,
            storage_path: path,
            mime_type: "image/png",
          })),
        );
      }

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
