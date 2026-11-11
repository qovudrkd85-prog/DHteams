# 데이터베이스 설치와 업데이트

## 기존 설치에 사무실·개인 계정 추가

Supabase SQL Editor에서 다음 순서로 전체 파일을 실행합니다. 기존 과업·일정·메모는 유지되며 각 파일은 재실행할 수 있습니다.

1. `department_events` 테이블이 없다면 `schema-department-events.sql`.
2. `schema-team-workspace.sql`: 팀원·출퇴근·사무실과 일정 등록자.
3. `schema-accounts.sql`: 계정과 프로필 연결, 익명 접근 차단, 본인 프로필·출퇴근 권한.
4. **`schema-office-presence.sql`: 마지막에 실행.** 본인 좌석·상태 메시지·이동 위치·사무실 4개·마당·카페.
5. Authentication 설정에서 **Email provider 활성화**, **회원가입 허용**, **Confirm Email 끄기**.
6. 변경된 앱을 배포하고 아이디·비밀번호로 가입합니다. 첫 로그인에서 이름·직책을 설정합니다.

`npm run db:prepare`는 SQL Editor에 전달할 파일 2개를 로컬에 생성합니다. 계정까지 설치된 DB는 `artifacts/setup/teams-office-world-upgrade.sql`, 이전 공유 모드 DB는 `artifacts/setup/teams-account-upgrade.sql`을 선택해 **전체 내용을 수동 실행**합니다. 두 파일 모두 하나의 트랜잭션이며 자동으로 운영 DB에 적용하지 않습니다.

앱은 아이디를 내부 이메일 별칭으로 변환해 Supabase Auth를 사용합니다. 사용자에게 이메일을 요구하지 않으므로 이메일 확인을 켜 두면 가입할 수 없습니다. 서버는 설정과 SQL 준비 여부를 먼저 확인합니다. 비밀번호는 Auth에서 해시로 관리하고 `team_members`에 저장하지 않습니다.

이전의 이름만 등록한 팀원은 보존하며 신규 계정에 자동으로 연결하지 않습니다. 새로 가입한 팀원이 빈 책상을 본인 자리로 선택합니다. 기존 자리 배정과 일정의 등록자·이름·색상 기록은 유지됩니다.

**최신 설치 후 `schema-open-mode.sql`이나 이전 공유 정책 SQL만 다시 실행하지 마세요.** 이전 정책이 다시 열릴 수 있습니다. 복구·재적용은 전체 통합 파일을 사용해 `schema-accounts.sql` 다음에 반드시 `schema-office-presence.sql`까지 완료합니다. 계정 SQL만 마지막으로 실행하면 상태 메시지 변경 권한이 사라질 수 있습니다.

## 한 사람이 여러 팀에 소속 (schema-team-memberships.sql)

`schema-teams.sql` 이 설치된 DB에 추가합니다. 소속은 `team_memberships`(여러 줄), `team_members.team_id` 는 "지금 보는 팀"입니다(폰·PC 공유). 출퇴근은 팀별 1줄입니다. PostgreSQL 15 이상이 필요합니다.

1. 백업: SQL Editor에서 `select id, team_id from team_members` 와 `select * from teams` 를 CSV로 내려받습니다. `select count(*) from team_members where team_id is not null` 값을 적어 둡니다.
2. `npm run db:prepare` → `artifacts/setup/teams-memberships-upgrade.sql` 전체를 SQL Editor에서 실행합니다(한 트랜잭션).
3. 확인: `select count(*) from team_memberships` 가 1번 값과 같고, 아래가 0 이어야 합니다.
   `select count(*) from team_members m where m.team_id is not null and not exists (select 1 from team_memberships s where s.member_id = m.id and s.team_id = m.team_id);`
4. 곧바로 새 앱을 배포합니다. 1~4 사이에는 옛 앱의 출근 버튼이 오류를 냅니다(출퇴근 고유키가 바뀜). 나머지 기능은 옛 앱에서도 동작합니다.

되돌리기(승인 필요): `artifacts/setup/teams-memberships-rollback.sql` 실행 → 곧바로 이전 앱 배포. 각자 지금 보던 팀이 그 사람의 팀이 되고, 두 번째 이후 소속은 화면에서 사라집니다(소속 표는 `team_memberships_rolled_back` 으로 보관). 같은 날 두 팀에 출근한 기록이 있으면 실행이 멈춥니다.

설치 뒤에는 `schema-teams.sql` 만 다시 실행하지 마세요. 팀 규칙이 옛날로 돌아가므로 파일이 스스로 멈춥니다.

## 새 공유 공간 설치 순서

1. `schema.sql`: 과업·폴더·파일·이력과 초기 권한 구조.
2. `schema-open-mode.sql`: 초기 공유 구조로 전환. 최종 접근 권한은 이후 계정·사무실 월드 SQL에서 적용합니다.
3. `schema-update-all.sql`: DIDAS 체크·과업별 일정·월 메모 기본 부가기능.
4. `schema-trash.sql`: 소프트 삭제와 휴지통용 컬럼.
5. `schema-department-events.sql`: 부서 공유 달력.
6. `schema-team-workspace.sql`: 팀원·출퇴근·사무실·업무 일정 등록자.
7. `schema-accounts.sql`: 계정 권한.
8. `schema-office-presence.sql`: 최종 좌석·상태·공간·이동 권한.
9. 위 Auth 설정을 적용합니다.

SQL Editor에서 각 단계의 성공을 확인한 후 다음 단계를 실행하세요. 브라우저용 공개 키만으로는 테이블을 생성할 수 없습니다.

## 파일별 역할

| 파일 | 용도 |
| --- | --- |
| `schema.sql` | 최초 과업 테이블 |
| `schema-open-mode.sql` | 초기 공유 구조로 전환 |
| `schema-update-all.sql` | DIDAS·과업 일정·월 메모 묶음 |
| `schema-didas.sql` | DIDAS 단독 업데이트 |
| `schema-schedules.sql` | 과업 일정 단독 업데이트 |
| `schema-memos.sql` | 월 메모 단독 업데이트 |
| `schema-trash.sql` | 휴지통 업데이트 |
| `schema-department-events.sql` | 부서 공유 일정 |
| `schema-team-workspace.sql` | 사무실과 팀원 출퇴근 |
| `schema-accounts.sql` | 개인 계정과 본인 권한, 익명 접근 차단 |
| `schema-office-presence.sql` | 본인 자리·상태 메시지·6개 공간·캐릭터 위치 |
| `schema-teams.sql` | 팀 공간(초대코드)·개인 일정 |
| `schema-team-memberships.sql` | 한 사람 여러 팀 소속·팀 바꾸기·팀별 출퇴근 |
| `rollback-team-memberships.sql` | 위 파일 되돌리기(승인 필요) |
| `schema-personal-library.sql` | 개인 메모·PC 폴더·파일 목록·파일 메모(사람 소유, 팀 무관) |
| `rollback-personal-library.sql` | 위 파일 되돌리기(자료 삭제, 승인 필요) |
| `schema-schedules-updated-at.sql` | 과업 일정 동시 수정 충돌 검사(updated_at·자동 갱신). `schema-teams.sql` 뒤 적용 |
| `schema-memo-items.sql` | 월 주요사항 한 줄 = 한 항목, 기존 월 메모 옮김(원본 유지). `schema-schedules-updated-at.sql` 다음 적용 |
| `rollback-memo-items.sql` | 위 파일 되돌리기(항목 자료 삭제, 승인 필요) — 되돌릴 때만 |
| `schema-schedule-blocks.sql` | 주간 할 일 줄 종류(kind: 할 일·텍스트·제목·글머리·번호)·하루 안 순서(sort_order). 기존 일정은 할 일로 남음. `schema-schedules-updated-at.sql` 뒤 적용 |
| `rollback-schedule-blocks.sql` | 위 파일 되돌리기(블록 줄 휴지통으로, 칼럼 삭제, 승인 필요) — 되돌릴 때만 |

이전 단독 업데이트 파일은 기존 설치 이력을 확인할 수 있도록 보존합니다. `schema-update-all.sql`은 위의 기본 부가기능 묶음이며 새 사무실 SQL까지 포함하는 파일은 아닙니다.

## 계정 운영

- 로그인한 팀원이 과업·일정·배치도를 공동 편집합니다. 별도 관리자 등급은 없습니다.
- 프로필과 출퇴근은 본인만 변경하며, 다른 팀원 상태는 읽을 수 있습니다.
- 자리 선택·해제와 상태·이동 위치도 본인만 변경합니다. 다른 팀원의 책상 위치는 함께 꾸밀 수 있지만 자리 배정이나 책상을 지울 수는 없습니다. 배치도 삭제는 모든 자리를 비운 뒤 가능합니다.
- 회원가입을 허용한 동안 사이트를 방문한 사람은 계정을 만들 수 있습니다. 모든 팀원 가입 후 추가 가입을 막으려면 Auth 설정에서 신규 가입을 끌 수 있습니다.
- 이메일을 받지 않으므로 이메일 비밀번호 재설정은 제공하지 않습니다. 로그인 중에는 내 설정에서 현재 비밀번호 확인 후 변경합니다. 분실 시 Supabase 관리자가 해당 사용자 ID를 확인해 Auth 관리 기능으로 재설정합니다.
- 계정 삭제는 기록 보존을 위해 연결된 프로필이 있으면 제한됩니다. 팀원 탈퇴·관리자 페이지는 현재 범위에 포함되지 않습니다.

인증 설정 참고: [Supabase Auth 일반 설정](https://supabase.com/docs/guides/auth/general-configuration), [비밀번호 인증](https://supabase.com/docs/guides/auth/passwords).
