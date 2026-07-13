import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { TRANSCRIBE_MODEL } from "@/lib/openai";

/**
 * 브라우저가 OpenAI 실시간 전사에 직접 붙으려면 키가 필요한데, 진짜 API 키를 내려보내면
 * 그대로 털린다. 그래서 수명이 짧고 전사에만 쓸 수 있는 임시 키를 서버에서 발급해 준다.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: TRANSCRIBE_MODEL, language: "ko" },
            // 말을 멈추면 서버가 알아서 한 문장으로 끊어 확정해 준다.
            turn_detection: { type: "server_vad", silence_duration_ms: 600 },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "음성 인식을 시작하지 못했습니다." }, { status: 500 });
  }

  const { value } = await res.json();
  return NextResponse.json({ token: value });
}
