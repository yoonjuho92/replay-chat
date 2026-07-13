import { NextResponse } from "next/server";
import { toFile } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { supabase, signImage, IMAGE_BUCKET } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { openai, CHAT_MODEL, IMAGE_MODEL, DRAW_TOOL, SYSTEM_PROMPT } from "@/lib/openai";
import { sniffImage, isDrawable } from "@/lib/image";

// 자서전 한 편이 2000-3000자라 생성이 길고, 그림도 세 장을 그린다.
export const maxDuration = 300;

type Scene = { title: string; prompt: string };
type Photo = { bytes: Buffer; mime: string; ext: string };

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

/**
 * 얼굴 참조로 쓸 사진을 내려받는다. DB 에 적힌 mime_type 은 브라우저가 알려준 값이라
 * 실제 내용과 다를 수 있어서, 바이트를 직접 보고 형식을 다시 정한다. 확장자와 내용이
 * 어긋나거나 그림 모델이 못 읽는 형식이면 OpenAI 가 "Invalid image file or mode" 로 거절한다.
 */
async function loadPhotos(attachments: { storage_path: string }[]) {
  const photos: Photo[] = [];

  for (const attachment of attachments) {
    const { data } = await supabase.storage.from(IMAGE_BUCKET).download(attachment.storage_path);
    if (!data) continue;

    const bytes = Buffer.from(await data.arrayBuffer());
    const kind = sniffImage(bytes);

    if (!kind || !isDrawable(kind.mime)) {
      console.error(`그림 참조로 못 쓰는 사진: ${attachment.storage_path} (${kind?.mime ?? "unknown"})`);
      continue;
    }

    photos.push({ bytes, mime: kind.mime, ext: kind.ext });
  }

  return photos;
}

/** 장면 하나를 그려서 스토리지에 올리고 경로를 돌려준다. */
async function drawScene(scene: Scene, style: string, photos: Photo[], userId: string) {
  // 파일 핸들은 요청마다 새로 만들어야 한다. 하나를 돌려 쓰면 두 번째 요청에서 비어 버린다.
  const images = await Promise.all(
    photos.map((photo, i) => toFile(photo.bytes, `photo-${i}.${photo.ext}`, { type: photo.mime })),
  );

  const drawing = await openai.images.edit({
    model: IMAGE_MODEL,
    image: images,
    prompt: drawPrompt(scene, style),
    size: "1024x1024",
    quality: "medium",
  });

  const b64 = drawing.data?.[0]?.b64_json;
  if (!b64) throw new Error("그림 모델이 이미지를 돌려주지 않았습니다.");

  const path = `${userId}/gen-${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, Buffer.from(b64, "base64"), { contentType: "image/png" });

  if (error) throw new Error(`그림 저장 실패: ${error.message}`);
  return path;
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
          // 가장 최근에 올린 사진을 얼굴 참조로 쓴다. 그림 모델이 못 읽는 형식은 여기서 걸러낸다.
          const photos = await loadPhotos(uploaded.slice(-2));

          // 사진 없이 그리면 얼굴을 살릴 수 없다. 모델에게 사실대로 알리고 사진을 청하게 한다.
          if (photos.length === 0) {
            input.push(call.item, {
              type: "function_call_output",
              call_id: call.id,
              output:
                uploaded.length === 0
                  ? "사용자가 올린 사진이 없어 그리지 못했다. 사진을 먼저 올려달라고 청해라."
                  : "올라온 사진을 그림 모델이 읽지 못했다. png 나 jpg 사진으로 다시 올려달라고 청해라.",
            });
            await run(input);
          } else {
            send("drawing", { scenes: call.scenes.map((s) => s.title) });

            const failed: string[] = [];

            // 세 장면을 한꺼번에 그린다. 순서대로 그리면 세 배로 오래 걸린다.
            // 한 장이 엎어져도 나머지는 살리고, 다 그려질 때까지 기다리지 않고 되는 대로 내보낸다.
            await Promise.all(
              call.scenes.map(async (scene) => {
                try {
                  const path = await drawScene(scene, call.style, photos, session.userId);
                  drawn.push({ path, caption: scene.title });
                  send("image", { url: await signImage(path), caption: scene.title });
                } catch (err) {
                  console.error(`그림 실패: ${scene.title}`, err);
                  failed.push(scene.title);
                }
              }),
            );

            // 그림을 다 그렸다고 알려주고 마무리 말을 하게 한다.
            input.push(call.item, {
              type: "function_call_output",
              call_id: call.id,
              output: JSON.stringify({
                drawn: drawn.map((d) => d.caption),
                failed,
                note:
                  drawn.length > 0
                    ? "그린 그림은 이미 사용자 화면에 떴다. 다시 설명하지 말고, 마음에 드는지 짧게 묻기만 해라. failed 에 담긴 장면은 그리다 실패했으니, 있으면 그 장면만 다시 그려볼지 짧게 물어라."
                    : "그림이 한 장도 그려지지 않았다. 사용자에게 짧게 사과하고 다시 해볼지 물어라.",
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
