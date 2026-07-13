# 리플레이 (replay-chat)

구술한 이야기를 **그 사람이 쓰던 말 그대로** 자서전으로 옮겨 적어주는 채팅 앱입니다.
사투리, 특유의 단어, 문장을 맺는 방식을 최대한 살려 3000–5000자 분량의 이야기를 만들어냅니다.

## 기능

- **아이디/비밀번호 로그인** — Supabase Auth 를 쓰지 않고 `users` 테이블에 직접 넣은 계정을 씁니다. 비밀번호는 bcrypt 해시로만 저장됩니다.
- **사진 업로드** — 입력창 **좌하단 `+` 버튼**. 이미지는 Supabase Storage 의 비공개 버킷에 저장되고, 모델에는 짧게 유효한 서명 URL 로 전달됩니다.
- **음성 입력** — 입력창 **우하단 마이크 버튼**. `gpt-4o-transcribe` 로 받아쓴 내용이 입력창에 채워질 뿐, **바로 전송되지 않습니다.** 사용자가 확인하고 Enter 를 눌러야 전송됩니다.
- **이전 이야기** — 좌상단 서랍(☰) 버튼으로 슬라이딩 패널이 열리고, 거기서 새 채팅을 시작하거나 지난 대화를 이어갈 수 있습니다.
- **비밀번호 변경** — 서랍 하단 → `/settings`. 지금 쓰는 비밀번호를 확인한 뒤에만 바뀝니다.
- 대화, 메시지, 이미지는 모두 Supabase 에 저장됩니다.
- 어르신이 보기 편하도록 본문 19px 기준의 큰 글자와 44px 이상의 터치 영역을 씁니다.

## 모델

| 용도 | 모델 |
| --- | --- |
| 대화·집필 | `gpt-5.6-luna` (Responses API, 스트리밍) |
| 음성 인식 | `gpt-4o-transcribe` |

`.env.local` 의 `OPENAI_CHAT_MODEL` 로 바꿀 수 있습니다.

## 보안 구조

DB 접근은 **전부 Next.js route handler 안에서만** 일어납니다. 브라우저는 Supabase 를 직접 호출하지 않습니다.

- 모든 테이블에 RLS 를 켜두고 **정책을 하나도 만들지 않았습니다.** 따라서 anon 키로는 어떤 행도 읽거나 쓸 수 없습니다.
- 서버는 `SUPABASE_SECRET_KEY`(RLS 우회)로 접근하되, 모든 쿼리에 세션의 `user_id` 조건을 함께 겁니다. 남의 대화 id 를 알아내도 열리지 않습니다.
- 이미지 버킷도 비공개입니다. 화면에 보여줄 때만 1시간짜리 서명 URL 을 발급합니다.
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
