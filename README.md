# 리플레이 (replay-chat)

구술한 이야기를 **그 사람이 쓰던 말 그대로** 자서전으로 옮겨 적어주는 채팅 앱입니다.
사투리, 특유의 단어, 문장을 맺는 방식을 최대한 살려 3000–5000자 분량의 이야기를 만들어냅니다.

## 기능

- **아이디/비밀번호 로그인** — Supabase Auth 를 쓰지 않고 `users` 테이블에 직접 넣은 계정을 씁니다. 비밀번호는 bcrypt 해시로만 저장됩니다.
- **이야기 박스** — 완성된 이야기는 모델이 `<story>…</story>` 로 감싸 보내고, 화면에서는 글자 수와 복사 버튼이 달린 별도의 박스로 그려집니다. 태그 자체는 화면에 새어 나오지 않습니다. 박스 뒤에는 "수정할 부분이 있으시면 말씀해 주세요." 가 붙습니다.
- **실시간 음성 입력** — 입력창 **우하단 마이크 버튼**. 말하는 동안 받아쓴 글이 입력창에 **한 조각씩 실시간으로 차오릅니다.** 다만 **저절로 전송되지는 않습니다.** 사용자가 확인하고 Enter 를 눌러야 나갑니다. 보내기를 누르면 녹음은 자동으로 멈춥니다.
- **사진 업로드** — 입력창 **좌하단 `+` 버튼**. 이미지는 Supabase Storage 의 비공개 버킷에 저장되고, 모델에는 짧게 유효한 서명 URL 로 전달됩니다.
- **그림 그리기** — 사용자가 그림을 청하면 ①사진부터 올리게 하고 ②그림체를 물은 뒤 ③같은 그림체로 **세 장**을 그려 고르게 합니다. 그린 그림도 대화에 저장되어 다시 열어도 남아 있고, 이어서 고쳐 그릴 수 있습니다.
- **이전 이야기** — 좌상단 서랍(☰) 버튼으로 슬라이딩 패널이 열리고, 거기서 새 채팅을 시작하거나 지난 대화를 이어갈 수 있습니다.
- **/admin** — `윤주호` 계정으로만 들어갈 수 있습니다. 대화(세션)별로 완성된 이야기와 그 세션에서 그린 그림을 모아 보고, 비밀번호를 바꿉니다.
- 어르신이 보기 편하도록 본문 19px 기준의 큰 글자와 44px 이상의 터치 영역을 씁니다.

## 모델

| 용도 | 모델 |
| --- | --- |
| 대화·집필 | `gpt-5.6-luna` (Responses API, 스트리밍) |
| 음성 인식 | `gpt-4o-transcribe` (Realtime API, 실시간 전사) |
| 그림 | `gpt-image-2` (Responses API 내장 `image_generation` 도구) |

`.env.local` 로 바꿀 수 있습니다.

## 보안 구조

DB 접근은 **전부 Next.js route handler 안에서만** 일어납니다. 브라우저는 Supabase 를 직접 호출하지 않습니다.

- 모든 테이블에 RLS 를 켜두고 **정책을 하나도 만들지 않았습니다.** 따라서 anon 키로는 어떤 행도 읽거나 쓸 수 없습니다.
- 서버는 `SUPABASE_SECRET_KEY`(RLS 우회)로 접근하되, 모든 쿼리에 세션의 `user_id` 조건을 함께 겁니다. 남의 대화 id 를 알아내도 열리지 않습니다.
- 이미지 버킷도 비공개입니다. 화면에 보여줄 때만 유효 시간이 짧은 서명 URL 을 발급합니다.
- 실시간 음성 인식은 브라우저가 OpenAI 에 직접 붙어야 하는데, 진짜 API 키 대신 **수명이 짧고 전사에만 쓸 수 있는 임시 키**를 서버(`/api/realtime-token`)에서 발급해 내려줍니다.
- `src/lib/supabase.ts` 와 `src/lib/openai.ts` 는 `server-only` 로 표시돼 있습니다. 클라이언트 컴포넌트가 실수로 import 하면 빌드가 깨집니다.
- `SUPABASE_SECRET_KEY` 에 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. 붙이는 순간 브라우저 번들에 그대로 실려 DB 전체가 열립니다.

## 설치

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

Supabase 스키마는 [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) 을 SQL Editor 에 붙여 넣으면 만들어집니다.

계정은 DB 에 직접 넣습니다.

```bash
node -e "console.log(require('bcryptjs').hashSync('비밀번호', 10))"
```

```sql
insert into public.users (username, password_hash, display_name)
values ('아이디', '<위에서 나온 해시>', '이름');
```

`/admin` 에 들어갈 수 있는 사람은 [`src/lib/admin.ts`](src/lib/admin.ts) 의 `ADMINS` 목록으로 정합니다.
