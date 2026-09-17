# DH Teams

팀원들이 사무실을 꾸미고 출퇴근과 일정을 공유하며, 과업별 파일·업무 이력을 정리하는 웹 앱입니다.

## 사용할 수 있는 기능

- **우리 사무실**: 방향키로 캐릭터를 움직이며 사무실 4개·야외 마당·카페를 오갑니다. 본인 책상을 선택하고 앉거나 일어서며, 가구와 공간 크기를 꾸밉니다.
- **회원가입과 내 설정**: 아이디·비밀번호로 가입/로그인하고 본인의 이름·직책·캐릭터·색상을 설정합니다. 비밀번호 변경과 로그아웃을 지원합니다.
- **팀원과 출퇴근**: 로그인한 본인의 한국 날짜 기준 출근·퇴근과 상태 메시지를 기록하고 팀원의 위치를 공유합니다.
- **공유 달력**: 업무/회의/회식/휴가/외근·출장/기타. 등록자 이름·색상, 내 일정·팀원별 필터, 공동 수정, 삭제 취소.
- **과업 관리**: 과업 검색, 폴더·파일 트리, 수신·수정·발송·확인 이력, DIDAS 체크, 과업별 업무 달력, 월 메모, 휴지통.

팀원들은 일정과 사무실을 함께 수정합니다. 프로필과 출퇴근은 본인만 변경하며, 일정에는 처음 등록한 계정의 이름과 색상이 남습니다.

## 실행

상위 폴더 또는 이 폴더의 `Teams-Start.bat`를 실행합니다. 경로에 공백·한글이 있어도 동작하도록 실제 실행 로직을 `scripts/start-teams.ps1`에 모았습니다. 터미널에서는 다음과 같이 실행할 수 있습니다.

```powershell
npm ci
npm run dev
```

브라우저에서 <http://localhost:3000>을 엽니다. 환경변수는 `.env.local.example`을 참고해 `.env.local`에 설정합니다. 기존 `.env.local`의 값은 유지하세요.

## 데이터베이스 업데이트

**개인 계정이 이미 설치된 운영 DB에는 `npm run db:prepare`로 생성한 `artifacts/setup/teams-office-world-upgrade.sql` 전체를 Supabase SQL Editor에서 수동 적용한 후 새 앱을 배포합니다.** 파일 생성은 DB를 변경하지 않습니다. [공간 사용법과 업데이트 안내](docs/OFFICE_WORLD.md)를 참고하세요.

이전 공유 모드 설치는 `artifacts/setup/teams-account-upgrade.sql`을 적용합니다. 원본 순서는 [팀 공간](supabase/schema-team-workspace.sql) → [계정](supabase/schema-accounts.sql) → [사무실 월드](supabase/schema-office-presence.sql)이며, **사무실 월드 SQL이 마지막**입니다. 부서 일정 테이블이 없다면 [부서 일정 SQL](supabase/schema-department-events.sql)을 먼저 실행하고 Supabase Auth의 Confirm Email을 끕니다.

마이그레이션은 기존 과업·일정을 유지합니다. 이전 일정은 '등록자 미지정'으로 표시됩니다. 이전에 이름만 등록했던 프로필은 보존하며 동명이인 계정과 자동 연결하지 않습니다. 가입 준비가 안 된 서버에서는 원인을 안내하고 가입을 진행하지 않습니다.

새 설치의 전체 SQL 실행 순서와 파일별 역할은 [데이터베이스 안내](supabase/README.md)에 정리했습니다. 로컬 코드 변경은 배포 사이트에 자동으로 반영되지 않습니다.

## 폴더 구성

```text
app/
├─ src/
│  ├─ app/                  # 시작 화면, 과업 페이지, 설정, 서버 API
│  ├─ components/
│  │  ├─ account/           # 가입·로그인·내 설정·계정 상태
│  │  ├─ team/              # 사무실 그림·편집기, 팀원/출퇴근 패널
│  │  ├─ ui/                # 공통 UI 부품
│  │  └─ *.tsx              # 공유 달력과 기존 과업 기능
│  └─ lib/
│     ├─ account/           # 계정 타입·입력 검증
│     ├─ team/              # 팀 데이터 타입·저장 함수·화면 상태
│     ├─ supabase/          # DB 클라이언트
│     └─ *.ts               # 일정·과업 쿼리와 공통 로직
├─ supabase/                # 스키마/업데이트 SQL와 실행 순서
├─ docs/                    # 구현 계획, 구조, 검증 기록
├─ scripts/                 # 로컬 실행·브라우저 테스트 실행기
├─ tests/                   # 모의 API 브라우저 검사와 로컬 DB 검사
├─ public/                  # 정적 자산
└─ artifacts/               # 생성된 캡처/로그, Git 제외
```

`node_modules/`, `.next/`, `artifacts/`, `*.tsbuildinfo`는 자동 생성 파일입니다. 기능 코드는 `src/`에만 둡니다. [구조 설명](docs/architecture.md)과 [사무실 구현 계획](docs/workspace-plan.md)을 참고하세요.

이전 상위 폴더의 빌드 캐시, 임시 테스트 도구, 사용하지 않는 기본 SVG는 `artifacts/archive/`에 보관했습니다. 현재 앱과 테스트는 이 보관 폴더를 사용하지 않습니다.

## 검증

```powershell
npm run lint
npm run test:data
npm run build
npm run test:server
npm run test:browser
```

브라우저 검증은 로컬 production 서버를 임시 포트에 실행하고 종료 시 정리합니다. Chromium이 없다면 `npx playwright install chromium`을 먼저 실행하세요. 기존 로컬 서버를 쓰려면 `TEST_BASE_URL`을 설정할 수 있습니다.

브라우저 테스트는 API를 모의 처리하고 DB 검사는 메모리 안의 PostgreSQL을 사용합니다. 서버 검사는 실제 Next API와 로컬 인증 서버를 연결해 쿠키·인증·프록시 동작을 확인합니다. 운영 Supabase 데이터는 변경하지 않습니다. 캡처는 `artifacts/`, 서버 로그는 `artifacts/logs/`에 생성합니다. 자세한 범위는 [테스트 안내](tests/README.md)를 참고하세요.

## 기술과 접속 구조

Next.js 16 / React 19 / TypeScript / Tailwind CSS / Supabase Auth·PostgreSQL을 사용합니다. 인증은 서버에서 검증하며 HttpOnly 쿠키로 세션을 관리합니다. 브라우저의 데이터 요청은 `/api/db`를 거쳐 본인의 권한으로 처리합니다. 환경변수와 비밀 키는 Git에서 제외합니다. 운영 적용 단계는 [배포 안내](docs/deployment.md)를 참고하세요.
