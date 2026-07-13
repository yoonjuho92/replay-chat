"use client";

import { useCallback, useRef, useState } from "react";

const SAMPLE_RATE = 24000;

/** 마이크 입력(Float32)을 실시간 전사가 받는 PCM16 으로 바꿔 넘겨주는 워크렛. */
const WORKLET = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0][0];
    if (channel) {
      const pcm = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`;

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** AudioContext 가 24kHz 를 안 받아주는 브라우저(주로 사파리)를 위한 단순 리샘플. */
function resample(pcm: Int16Array, from: number, to: number) {
  if (from === to) return pcm;

  const ratio = from / to;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = pcm[Math.floor(i * ratio)];
  return out;
}

export function useRealtimeTranscription() {
  const [recording, setRecording] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream } | null>(null);

  // 서버 VAD 가 말을 문장 단위로 끊어 주는데, 끊긴 문장(확정)과 지금 말하는 중인 문장(임시)이
  // 섞여 들어온다. item 별로 담아 둬야 순서가 안 뒤집힌다.
  const items = useRef<{ id: string; text: string }[]>([]);

  const render = useCallback(() => {
    setTranscript(
      items.current
        .map((i) => i.text.trim())
        .filter(Boolean)
        .join(" "),
    );
  }, []);

  const cleanup = useCallback(() => {
    ws.current?.close();
    ws.current = null;

    audio.current?.stream.getTracks().forEach((t) => t.stop());
    audio.current?.ctx.close().catch(() => {});
    audio.current = null;

    setRecording(false);
    setConnecting(false);
  }, []);

  const stop = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setConnecting(true);
    items.current = [];
    setTranscript("");

    try {
      const res = await fetch("/api/realtime-token", { method: "POST" });
      if (!res.ok) throw new Error("음성 인식을 시작하지 못했습니다.");
      const { token } = await res.json();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audio.current = { ctx, stream };

      const socket = new WebSocket("wss://api.openai.com/v1/realtime", [
        "realtime",
        `openai-insecure-api-key.${token}`,
      ]);
      ws.current = socket;

      socket.onerror = () => {
        setError("음성 인식 서버에 연결하지 못했습니다.");
        cleanup();
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === "conversation.item.input_audio_transcription.delta") {
          const found = items.current.find((i) => i.id === message.item_id);
          if (found) found.text += message.delta;
          else items.current.push({ id: message.item_id, text: message.delta });
          render();
        } else if (message.type === "conversation.item.input_audio_transcription.completed") {
          const found = items.current.find((i) => i.id === message.item_id);
          if (found) found.text = message.transcript;
          else items.current.push({ id: message.item_id, text: message.transcript });
          render();
        } else if (message.type === "error") {
          setError("음성을 옮기는 중 문제가 생겼습니다.");
        }
      };

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        setTimeout(() => reject(new Error("연결이 지연되고 있습니다.")), 10000);
      });

      const blob = new Blob([WORKLET], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const node = new AudioWorkletNode(ctx, "pcm-processor");
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (socket.readyState !== WebSocket.OPEN) return;

        const pcm = resample(new Int16Array(e.data), ctx.sampleRate, SAMPLE_RATE);
        socket.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: toBase64(pcm.buffer as ArrayBuffer),
          }),
        );
      };

      ctx.createMediaStreamSource(stream).connect(node);
      // 워크렛은 목적지에 연결돼야 돌아간다. 소리를 되울리면 안 되니 볼륨 0 으로 물린다.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);

      // 마이크 권한과 토큰을 기다리는 사이에 클릭이라는 사용자 제스처가 만료된다.
      // 그러면 AudioContext 가 suspended 로 남아 워크렛이 아예 돌지 않는다.
      if (ctx.state === "suspended") await ctx.resume();

      setConnecting(false);
      setRecording(true);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "마이크를 사용할 수 없습니다. 브라우저 권한을 확인해주세요."
          : err instanceof Error
            ? err.message
            : "음성 인식을 시작하지 못했습니다.",
      );
      cleanup();
    }
  }, [cleanup, render]);

  return { recording, connecting, transcript, error, start, stop };
}
