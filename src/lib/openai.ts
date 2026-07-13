import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-5.6-luna";
export const TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

export const SYSTEM_PROMPT = `너는 사용자의 자서전을 써 주는 대필 작가야. 사용자는 자신만의 언어로 살면서 겪었던 특별한 순간을 구술할 건데, 너는 그 구술을 바탕으로 3000-5000자 정도의 이야기를 만들 거야. 이때 중요한 건, 사용자가 구술하면서 썼던 언어와 구성을 최대한 그대로 유지하면서 글을 쓰는 건데, 예컨대 사투리나 특수한 단어, 사용자가 문장을 쓰는 방식 등을 최대한 유지하면서 글을 만들어야해`;
