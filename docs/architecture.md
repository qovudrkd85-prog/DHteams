# 코드 구조와 데이터 흐름

## 시작 화면

`src/app/page.tsx`는 과업 목록과 팀 공간을 조합합니다.

- `components/team/office.tsx`: SVG 캐릭터와 가구, 좌석 표시, 배치도 편집/저장. 그림 스타일은 같은 폴더의 `office.module.css`에 있습니다.
- `components/account/`: 가입/로그인, 필수 첫 프로필 설정, 내 설정, 계정 상태.
- `components/team/panel.tsx`: 본인 출퇴근 버튼, 읽기 전용 팀원 목록과 상태.
- `lib/team/use-team-workspace.ts`: 계정에 연결된 현재 프로필, 팀원·출퇴근 조회와 갱신, 중복 요청 보호.
- `lib/team/workspace.ts`: 팀원/출퇴근/가구/배치도 타입, 데이터 검증, Supabase 저장 함수.
- `components/department-calendar.tsx` / `lib/department-events.ts`: 공유 달력, 업무 유형, 일정 CRUD, 최초 등록자와 필터.

브라우저 로컬 저장소에는 선택한 배치도 ID만 기억합니다. 본인 식별은 서버가 검증한 로그인 계정을 사용합니다. 팀원·출퇴근·배치도·일정은 Supabase에 저장하며 로컬 임시 저장을 공유 저장 성공으로 취급하지 않습니다.

## 과업 화면

`src/app/projects/[id]/page.tsx` → `components/project-workspace.tsx`가 과업 데이터를 불러오고 아래 화면을 조합합니다.

- `node-tree.tsx`: 폴더·파일 선택과 정리.
- `log-table.tsx`: 파일별 수신/수정/발송/확인 이력.
- `schedule-calendar.tsx`: 과업별 업무 달력과 포스트잇.
- `month-memo.tsx`: 월별 메모.
- `trash-dialog.tsx`: 삭제한 과업·폴더·파일·이력·일정 복구.
- `lib/queries.ts` / `lib/types.ts`: 기존 과업 데이터 요청과 타입.

과업별 `schedules`와 부서 공유 `department_events`는 다른 테이블입니다. 이번 최초 등록자 표시/업무 유형 추가는 부서 공유 달력에 적용합니다. 기존 `project_members`는 초기 계정 기반 과업 접근 모델이며 새 공간의 프로필 `team_members`와 별개입니다.

월 메모는 월/과업 전환 시 대기 중인 저장을 시작하고 같은 월 저장 순서를 보장합니다. 파일 이력은 서버 저장이 성공한 값만 목록에 반영하며, 실패한 텍스트 입력은 재시도할 수 있도록 화면에 남겨 둡니다. 폴더 휴지통 복구는 기존과 같이 개별 항목 단위입니다.

## 서버와 데이터베이스

`AccountProvider`는 `/api/session`으로 로그인 상태를 확인합니다. 가입은 `/api/account/register`, 프로필과 비밀번호 변경은 각각 `/api/account/profile`, `/api/account/password`에서 처리합니다. `lib/server-auth.ts`가 Supabase Auth와 HttpOnly 세션 쿠키를 관리하며 `auth.getUser()`로 사용자를 확인합니다. 브라우저에는 인증 토큰을 전달하거나 로컬 저장소에 보관하지 않습니다.

`lib/supabase/client.ts`는 항상 같은 출처의 `/api/db/[...path]`로 요청합니다. 프록시는 앱에서 사용하는 테이블만 허용하고, 검증한 사용자의 액세스 토큰으로 Supabase에 접근합니다. 익명 직접 연결이나 관리자 키 우회는 없습니다. 변경 요청은 Origin도 확인합니다.

`schema-accounts.sql`의 가입 트리거가 Auth 계정과 팀원 프로필을 같은 트랜잭션으로 만듭니다. `user_id`와 `username`은 변경할 수 없습니다. RLS는 연결된 팀원만 공유 데이터에 접근하게 하고 프로필·출퇴근 변경은 본인에게만 허용합니다. 기존 작성자 기록은 유지합니다. 오래된 공용 `teams_sid` 쿠키는 인증으로 인정하지 않습니다.

세션 쿠키에는 영구 만료 시간을 지정하지 않습니다. 새로고침은 로그인 상태를 유지하고 로그아웃은 쿠키와 화면 상태를 비웁니다. 브라우저의 세션 복원 설정에 따라 창을 다시 열어도 쿠키가 복원될 수 있으므로 공용 PC에서는 로그아웃을 사용합니다. 세션 만료 시 업무 화면을 닫고 로그인 화면으로 돌아갑니다.

## 저장과 충돌 처리

- 출퇴근 날짜/시각은 서버가 한국 날짜로 확정합니다. 팀원·날짜 고유 제약으로 중복 출근을 막고 기존 퇴근 시각을 보존합니다.
- 배치도와 부서 일정은 읽었던 `updated_at`과 일치할 때만 수정합니다. 충돌 시 작성 중인 내용을 남겨 두고 최신 상태 확인을 안내합니다.
- 사무실 보기 상태는 공유 변경을 주기적으로 반영합니다. 편집 중에는 자동 갱신으로 초안을 교체하지 않습니다.
- 일정 등록자 필드는 DB 트리거가 최초 값을 보존하고, 기존 등록자 없는 일정은 그대로 유지합니다.

## 폴더 정리 원칙

문서는 `docs/`, 데이터베이스 설명은 SQL 옆 `supabase/README.md`, 실행 도구는 `scripts/`, 검증 코드는 `tests/`에 둡니다. 테스트 의존성은 `package.json`의 개발 의존성으로 설치합니다. 별도 임시 도구용 `node_modules`를 만들지 않습니다.

루트의 `AGENTS.md`, `CLAUDE.md`와 Next.js 설정 파일은 도구가 기대하는 위치에 유지합니다. 상위 폴더의 바로가기와 실행 파일은 사용자가 실행하는 진입점입니다.
