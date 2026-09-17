# 운영 적용 순서

## 현재 준비 상태

2026-09-17 사용자가 계정 업데이트와 **`teams-office-world-upgrade.sql` 전체의 운영 적용 성공**을 Supabase SQL Editor에서 확인했습니다. 같은 날 `npm run deploy:check`에서 계정 준비, Email provider, 신규 가입, Confirm Email 비활성화, 익명 데이터 접근 차단이 모두 통과했습니다. SQL 파일 생성과 로컬 DB 테스트는 운영 DB를 변경하지 않습니다. 이 PC의 공개 키에는 SQL 관리 권한이 없습니다.

## 1. Supabase 적용

`npm run db:prepare`로 최신 파일을 생성합니다. 현재처럼 개인 계정이 설치된 DB에는 **`artifacts/setup/teams-office-world-upgrade.sql` 전체를 SQL Editor에서 수동 실행**합니다. 이전 공유 모드에서 전체 업데이트할 때는 `artifacts/setup/teams-account-upgrade.sql`을 사용합니다. 두 파일 모두 트랜잭션 하나로 묶여 오류 시 전체가 취소됩니다. 원본 파일을 별도로 실행하려면 다음 순서를 따릅니다.

1. [schema-team-workspace.sql](../supabase/schema-team-workspace.sql)
2. [schema-accounts.sql](../supabase/schema-accounts.sql)
3. [schema-office-presence.sql](../supabase/schema-office-presence.sql) — 마지막에 적용

부서 달력 테이블이 없는 새 설치는 [전체 설치 순서](../supabase/README.md)를 따릅니다. 새 SQL 적용 성공을 확인한 다음 대응하는 앱을 배포하세요. 사무실 SQL은 계정 SQL 이후의 상태 권한과 넓은 좌표 검증을 추가하므로 계정 SQL만 다시 마지막에 실행하지 않습니다.

Authentication 설정에서 Email provider와 신규 가입을 활성화하고 **Confirm Email을 끕니다**. 아이디만 받는 앱이므로 이메일 확인 절차를 사용할 수 없습니다.

설정 완료 후 `npm run deploy:check`로 SQL 준비 여부·Auth 설정·익명 접근 차단을 읽기 전용으로 확인할 수 있습니다. 이 명령은 테이블·사용자·업무 데이터를 변경하지 않습니다.

관리 자동화를 사용하려면 PC에서 Supabase CLI 로그인을 완료하거나 DB 관리 연결을 설정합니다. 토큰·DB 비밀번호를 채팅이나 Git에 올리지 않습니다.

## 2. 환경변수 확인

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 또는 서버의 `SUPABASE_PUBLISHABLE_KEY`
- 서버 별도 주소가 있으면 `SUPABASE_URL`

기존 `SUPABASE_KEY`도 publishable/anon 키일 때 호환합니다. 서비스 역할 키와 secret 키는 거부합니다. `TEAM_PASSWORD`, `SESSION_SECRET`, `NEXT_PUBLIC_SECURE_MODE`는 새 코드에서 사용하지 않습니다.

## 3. 검증 후 배포

```powershell
npm run lint
npm run test:data
npm run build
npm run test:server
npm run test:browser
```

Git 원격 저장소는 `qovudrkd85-prog/DHteams`입니다. 확인된 Git 연결은 같은 `main`을 두 Vercel 프로젝트(`d-hteams`, `d-hteams-i16i`)에 배포합니다. `main` push 시 둘 모두 갱신될 수 있습니다. 기본 사이트는 <https://d-hteams.vercel.app>입니다.

DB 적용과 Auth 설정을 끝낸 뒤 검증한 변경을 커밋·push하거나 로그인된 Vercel CLI로 배포합니다. 로컬 파일 수정만으로 사이트가 바뀌지는 않습니다.

## 4. 실제 사용 확인

1. 팀원 본인이 회원가입하고 이름·직책을 설정합니다.
2. 내 설정에서 저장한 이름과 직책이 상단에 표시되는지 확인합니다.
3. 빈 책상을 본인 자리로 선택하고 출근·앉기·일어나기를 확인합니다.
4. 방향키로 걷고 사무실 4개·야외 마당·카페를 오가며, 다른 팀원이 상태 메시지와 이동 위치를 확인합니다.
5. 다른 팀원이 선택한 책상은 가져올 수 없고 새 업무 일정에는 본인 등록자가 표시되는지 확인합니다.
6. 로그아웃 후 업무 화면이 닫히고 다시 아이디·비밀번호로 들어오는지 확인합니다.

운영 검증에 사용할 팀원 계정은 실제 사용자 본인이 만듭니다. 로컬 자동 테스트는 운영 계정이나 업무 기록을 생성하지 않습니다.
