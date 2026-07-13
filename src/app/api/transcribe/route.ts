import { NextResponse } from "next/server";
import { toFile } from "openai";
import { openai, TRANSCRIBE_MODEL } from "@/lib/openai";
import { getSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const form = await req.formData();
  const audio = form.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "음성 파일이 없습니다." }, { status: 400 });
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      model: TRANSCRIBE_MODEL,
      file: await toFile(audio, "recording.webm", { type: audio.type || "audio/webm" }),
      language: "ko",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "음성 인식에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
