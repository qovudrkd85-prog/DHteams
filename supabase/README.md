# 데이터베이스 설치와 업데이트

## 기존 설치에 사무실·개인 계정 추가

Supabase SQL Editor에서 다음 순서로 전체 파일을 실행합니다. 기존 과업·일정·메모는 유지되며 각 파일은 재실행할 수 있습니다.

1. `department_events` 테이블이 없다면 `schema-department-events.sql`.
2. `schema-team-workspace.sql`: 팀원·출퇴근·사무실과 일정 등록자.
3. **`schema-accounts.sql`: 반드시 마지막에 실행.** 계정과 프로필 연결, 익명 접근 차단, 본인 프로필·출퇴근 권한.
4. Authentication 설정에서 **Email provider 활성화**, **회원가입 허용**, **Confirm Email 끄기**.
5. 변경된 앱을 배포하고 아이디·비밀번호로 가입합니다. 첫 로그인에서 이름·직책을 설정합니다.

앱은 아이디를 내부 이메일 별칭으로 변환해 Supabase Auth를 사용합니다. 사용자에게 이메일을 요구하지 않으므로 이메일 확인을 켜 두면 가입할 수 없습니다. 서버는 설정과 SQL 준비 여부를 먼저 확인합니다. 비밀번호는 Auth에서 해시로 관리하고 `team_members`에 저장하지 않습니다.

이전의 이름만 등록한 팀원은 보존하며 신규 계정에 자동으로 연결하지 않습니다. 새로 가입한 팀원에게 사무실 편집에서 책상을 배정하세요. 기존 일정의 등록자와 이름·색상 기록은 유지됩니다.

**계정 SQL 적용 후 `schema-open-mode.sql`이나 이전 공유 정책 SQL을 다시 실행하지 마세요.** 이전 정책이 다시 열릴 수 있습니다. 이전 SQL을 재적용해야 한다면 같은 관리 작업에서 `schema-accounts.sql`을 다시 마지막에 적용합니다.

## 새 공유 공간 설치 순서

1. `schema.sql`: 과업·폴더·파일·이력과 초기 권한 구조.
2. `schema-open-mode.sql`: 초기 공유 구조로 전환. 최종 접근 권한은 마지막 계정 SQL에서 적용합니다.
3. `schema-update-all.sql`: DIDAS 체크·과업별 일정·월 메모 기본 부가기능.
4. `schema-trash.sql`: 소프트 삭제와 휴지통용 컬럼.
5. `schema-department-events.sql`: 부서 공유 달력.
6. `schema-team-workspace.sql`: 팀원·출퇴근·사무실·업무 일정 등록자.
7. `schema-accounts.sql`: 최종 계정 권한.
8. 위 Auth 설정을 적용합니다.

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

이전 단독 업데이트 파일은 기존 설치 이력을 확인할 수 있도록 보존합니다. `schema-update-all.sql`은 위의 기본 부가기능 묶음이며 새 사무실 SQL까지 포함하는 파일은 아닙니다.

## 계정 운영

- 로그인한 팀원이 과업·일정·배치도를 공동 편집합니다. 별도 관리자 등급은 없습니다.
- 프로필과 출퇴근은 본인만 변경하며, 다른 팀원 상태는 읽을 수 있습니다.
- 회원가입을 허용한 동안 사이트를 방문한 사람은 계정을 만들 수 있습니다. 모든 팀원 가입 후 추가 가입을 막으려면 Auth 설정에서 신규 가입을 끌 수 있습니다.
- 이메일을 받지 않으므로 이메일 비밀번호 재설정은 제공하지 않습니다. 로그인 중에는 내 설정에서 현재 비밀번호 확인 후 변경합니다. 분실 시 Supabase 관리자가 해당 사용자 ID를 확인해 Auth 관리 기능으로 재설정합니다.
- 계정 삭제는 기록 보존을 위해 연결된 프로필이 있으면 제한됩니다. 팀원 탈퇴·관리자 페이지는 현재 범위에 포함되지 않습니다.

인증 설정 참고: [Supabase Auth 일반 설정](https://supabase.com/docs/guides/auth/general-configuration), [비밀번호 인증](https://supabase.com/docs/guides/auth/passwords).
