# DH Teams

과업별로 폴더와 파일을 구성하고, 파일의 수신·수정·발송·확인 이력을 기록하는 웹 앱입니다.

## 부서 대시보드 업데이트

첫 화면은 부서 공유 달력과 검색 가능한 과업 목록입니다. 과업을 선택하면 기존 파일·이력·과업별 일정 화면으로 이동합니다.

- 부서 일정: 회의 / 회식 / 휴가 / 외근·출장 / 기타, 여러 날 일정, 시간·장소·담당자·메모
- 일정 등록·수정·삭제, 삭제 알림에서 10초 동안 되돌리기
- 30초 간격 및 창에 다시 돌아왔을 때 새로고침
- 동시에 같은 일정을 수정한 경우 덮어쓰지 않고 재조회 안내
- PC는 달력 옆에 과업 목록, 모바일은 달력 아래에 과업 목록

기존 설치에는 **추가 SQL을 한 번 실행**해야 합니다.

1. Supabase SQL Editor에서 [`supabase/schema-department-events.sql`](supabase/schema-department-events.sql) 전체를 실행합니다.
2. `Success` 확인 후 새 코드를 배포합니다. 기존 과업 테이블 및 데이터는 변경하지 않습니다.
3. 부서 일정 1건을 등록한 뒤 다른 브라우저에서 조회·수정되는지 확인합니다.

테이블 생성 전에도 과업 목록은 사용할 수 있지만 부서 일정 등록은 비활성화됩니다. UI의 "저장소가 아직 준비되지 않았습니다" 안내는 위 SQL이 필요한 상태입니다. Publishable key로는 테이블을 생성할 수 없습니다.

새 테이블의 접근 정책은 현재 과업 일정의 공유 모드(`schedules_open`)와 같습니다. 현재처럼 `anon`/`authenticated`에 공유 조회·등록·수정을 허용하며, 서버 프록시 모드에서도 같은 데이터 함수를 사용합니다. SQL은 기존 테이블의 권한이나 환경변수를 바꾸지 않습니다.

### 브라우저 검증

`tests/department-dashboard.cjs`는 로컬 서버에서 API 응답을 모의 처리하며 운영 데이터를 변경하지 않습니다. Playwright가 설치된 환경에서 실행합니다. 기존 설치를 쓰려면 `PLAYWRIGHT_MODULE`에 해당 모듈 경로를 지정할 수 있습니다.

```bash
npm run build
npm run start -- --port 3001
# 다른 터미널
node tests/department-dashboard.cjs
```

검색/과업 링크, 일정 CRUD·복원, 새로고침 후 표시, 동시 수정 충돌, 저장 실패, 연도 경계, 모바일 가로 넘침, 테이블 미설치 안내를 확인합니다. `artifacts/`의 캡처는 테스트용 예시 데이터이며 Git에서 제외됩니다.

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
