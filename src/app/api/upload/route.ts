import { NextResponse } from "next/server";
import { supabase, signImage, IMAGE_BUCKET } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { sniffImage, isDrawable } from "@/lib/image";

// gpt-image 계열이 참조 사진으로 받아주는 한도가 장당 50MB 다. 거기까지 열어 둔다.
// 어차피 브라우저에서 올리기 전에 긴 변 2048px jpg 로 줄여서 보낸다.
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "이미지는 50MB 까지 올릴 수 있습니다." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // 브라우저가 붙여 준 file.type 이 아니라 실제 바이트를 보고 형식을 정한다.
  // 이게 어긋나면 나중에 그림을 그릴 때 OpenAI 가 사진을 거절한다.
  const kind = sniffImage(bytes);
  if (!kind || !isDrawable(kind.mime)) {
    return NextResponse.json(
      { error: "png, jpg, webp 사진만 올릴 수 있습니다. 다른 형식이면 사진으로 저장해서 올려주세요." },
      { status: 400 },
    );
  }

  const path = `${session.userId}/${crypto.randomUUID()}.${kind.ext}`;

  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType: kind.mime });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // message_id 는 아직 null. 사용자가 실제로 전송할 때 메시지에 연결된다.
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      user_id: session.userId,
      storage_path: path,
      mime_type: kind.mime,
      size_bytes: file.size,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, url: await signImage(path) });
}
