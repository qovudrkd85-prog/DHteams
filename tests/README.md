# 로컬 검증

`npm ci`로 개발 의존성까지 설치합니다. 필요한 경우 `npx playwright install chromium`을 실행합니다.

| 명령/파일 | 검증 범위 |
| --- | --- |
| `npm run test:data` | 아래 로컬 DB 검사 |
| `team-workspace-data.cjs` | PGlite 메모리 PostgreSQL에서 마이그레이션 재실행, 기존 데이터 보존, RLS, 출퇴근 제약, 등록자 보존, 가구 검증 |
| `account-data.cjs` | 계정 SQL 재실행, 가입 트리거, 익명 차단, 두 계정 간 프로필·출퇴근 권한, 작성자 위조 차단, 기존 데이터 보존 |
| `office-presence-data.cjs` | 실제 생성 SQL의 반복 적용, 기존 공간 보존·6개 방 생성, 두 계정의 자리 충돌·삭제 방지, 본인 상태·이동 권한과 좌표 범위 |
| `npm run test:server` | 실제 Next API와 로컬 모의 Supabase Auth로 인증 쿠키·서버 프록시·가입 준비 설정 검증 |
| `npm run test:browser` | production 서버 자동 시작 후 브라우저 검사, 끝나면 서버 종료 |
| `account-browser.cjs` | 가입·필수 내 설정·프로필 저장 실패/재시도·비밀번호 변경·로그아웃/재로그인·세션 만료·모바일 |
| `department-dashboard.cjs` | 과업 검색, 일정 CRUD·복원·충돌, 업무 유형·등록자 필터, 모바일 |
| `team-workspace.cjs` | 가입 계정·출퇴근·캐릭터·가구 이동·배치도 저장과 오류 처리 |
| `game-world.cjs` | 방향키 이동·입력/달력 중 이동 중지·방 전환·본인 자리 선택·앉기/일어나기·상태 메시지 |
| `project-workspace.cjs` | 기존 과업의 월 메모·이력·휴지통 회귀 검사 |

브라우저 검사 전에 `npm run build`를 실행하세요. 모든 API는 로컬에서 모의 처리하며 운영 데이터를 수정하지 않습니다. 개별 테스트를 실행하려면 로컬 서버를 켠 뒤 `node tests/<파일명>.cjs`를 실행합니다. 기본 주소는 `http://localhost:3001`입니다.

`TEST_BASE_URL`로 다른 **로컬** 서버를 지정할 수 있습니다. `PLAYWRIGHT_MODULE`과 `PGLITE_MODULE`은 기존 외부 도구 설치를 이용할 때만 선택적으로 지정합니다.

테스트용 캐릭터·팀원·일정이 들어간 캡처는 `artifacts/`, 자동 서버 로그는 `artifacts/logs/`에 저장하며 Git에 포함하지 않습니다.
