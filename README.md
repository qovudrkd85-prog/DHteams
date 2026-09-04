# DH Teams

과업별로 폴더와 파일을 구성하고, 파일의 수신·수정·발송·확인 이력을 기록하는 웹 앱입니다.

## 기술 구성

- Next.js 16 / React 19 / TypeScript
- Tailwind CSS / shadcn UI
- Supabase Auth / PostgreSQL / Row Level Security

## 로컬 실행

1. 의존성을 설치합니다.

   ```bash
   npm install
   ```

2. Supabase SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다.

3. `.env.local.example`을 참고해 `.env.local`을 만듭니다.

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

4. 개발 서버를 실행합니다.

   ```bash
   npm run dev
   ```

   브라우저에서 <http://localhost:3000>을 엽니다.

## 검증 명령

```bash
npm run lint
npm run build
```

## 보안

- 모든 업무 데이터 테이블에 RLS가 적용됩니다.
- `.env.local`과 기타 `.env*` 파일은 Git에서 제외되며, `.env.local.example`만 추적합니다.
- 클라이언트에는 Supabase Publishable key만 사용합니다. Secret key, service role key, 데이터베이스 비밀번호를 저장소에 추가하지 마세요.
