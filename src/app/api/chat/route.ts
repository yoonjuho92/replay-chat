import { NextResponse } from "next/server";
import { toFile } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { supabase, signImage, IMAGE_BUCKET } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { openai, CHAT_MODEL, IMAGE_MODEL, DRAW_TOOL, SYSTEM_PROMPT } from "@/lib/openai";

// 자서전 한 편이 3000-5000자라 생성이 길고, 그림도 세 장을 그린다.
export const maxDuration = 300;

type Scene = { title: string; prompt: string };
type Photo = { bytes: Buffer; mime: string };

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0];
  if (!line) return "새 대화";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

/** 그림 모델에 넘길 최종 지시문. 얼굴을 살리고 글씨는 넣지 않는다. */
function drawPrompt(scene: Scene, style: string) {
  return [
    `${style} 그림체로 그려라.`,
    `함께 주는 사진 속 인물이 이 그림의 주인공이다. 그 사람의 얼굴과 인상을 그대로 살려서, 같은 사람으로 알아볼 수 있게 그려라.`,
    `장면: ${scene.prompt}`,
    `그림 안에 글씨, 문자, 숫자, 간판, 서명, 워터마크를 절대 넣지 마라.`,
  ].join("\n");
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
    .select("id, role, content, created_at, attachments(storage_path, mime_type)")
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
  // 사용자가 올린 사진. 그림을 그릴 때 얼굴 참조로 쓴다.
  const uploaded: { storage_path: string; mime_type: string }[] = [];

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

    uploaded.push(...attachments);

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
      const drawn: { path: string; caption: string }[] = [];

      /** 한 번의 모델 호출을 스트리밍하면서, draw_scenes 를 부르면 그 호출을 돌려준다. */
      const run = async (items: ResponseInputItem[]) => {
        let call: { id: string; item: ResponseInputItem; scenes: Scene[]; style: string } | null =
          null;

        const events = await openai.responses.create({
          model: CHAT_MODEL,
          instructions: SYSTEM_PROMPT,
          input: items,
          tools: [DRAW_TOOL],
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
          } else if (
            event.type === "response.output_item.done" &&
            event.item.type === "function_call" &&
            event.item.name === DRAW_TOOL.name
          ) {
            const args = JSON.parse(event.item.arguments);
            call = {
              id: event.item.call_id,
              item: event.item,
              scenes: args.scenes as Scene[],
              style: String(args.style ?? ""),
            };
          } else if (event.type === "response.failed" || event.type === "error") {
            throw new Error("모델 응답이 실패했습니다.");
          }
        }

        return call;
      };

      try {
        const call = await run(input);

        if (call) {
          // 사진 없이 그리면 얼굴을 살릴 수 없다. 모델에게 사실대로 알리고 사진을 청하게 한다.
          if (uploaded.length === 0) {
            input.push(call.item, {
              type: "function_call_output",
              call_id: call.id,
              output: "사용자가 올린 사진이 없어 그리지 못했다. 사진을 먼저 올려달라고 청해라.",
            });
            await run(input);
          } else {
            send("drawing", { scenes: call.scenes.map((s) => s.title) });

            // 가장 최근에 올린 사진을 얼굴 참조로 쓴다.
            const photos: Photo[] = [];
            for (const attachment of uploaded.slice(-2)) {
              const { data } = await supabase.storage
                .from(IMAGE_BUCKET)
                .download(attachment.storage_path);
              if (data) {
                photos.push({
                  bytes: Buffer.from(await data.arrayBuffer()),
                  mime: attachment.mime_type,
                });
              }
            }

            // 세 장면을 한꺼번에 그린다. 순서대로 그리면 세 배로 오래 걸린다.
            const results = await Promise.all(
              call.scenes.map(async (scene) => {
                // 파일 핸들은 요청마다 새로 만들어야 한다. 하나를 돌려 쓰면 두 번째 요청에서 비어 버린다.
                const images = await Promise.all(
                  photos.map((photo, i) =>
                    toFile(photo.bytes, `photo-${i}.png`, { type: photo.mime }),
                  ),
                );

                const drawing = await openai.images.edit({
                  model: IMAGE_MODEL,
                  image: images,
                  prompt: drawPrompt(scene, call.style),
                  size: "1024x1024",
                  quality: "medium",
                });

                const b64 = drawing.data?.[0]?.b64_json;
                if (!b64) return null;

                const path = `${session.userId}/gen-${crypto.randomUUID()}.png`;
                const { error } = await supabase.storage
                  .from(IMAGE_BUCKET)
                  .upload(path, Buffer.from(b64, "base64"), { contentType: "image/png" });

                if (error) return null;
                return { path, caption: scene.title };
              }),
            );

            for (const result of results) {
              if (!result) continue;
              drawn.push(result);
              send("image", { url: await signImage(result.path), caption: result.caption });
            }

            // 그림을 다 그렸다고 알려주고 마무리 말을 하게 한다.
            input.push(call.item, {
              type: "function_call_output",
              call_id: call.id,
              output: JSON.stringify({
                drawn: drawn.map((d) => d.caption),
                note: "그림은 이미 사용자 화면에 떴다. 다시 설명하지 말고, 마음에 드는지 짧게 묻기만 해라.",
              }),
            });
            await run(input);
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
          drawn.map((d) => ({
            message_id: saved.id,
            conversation_id: conversationId,
            user_id: session.userId,
            storage_path: d.path,
            mime_type: "image/png",
            caption: d.caption,
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
