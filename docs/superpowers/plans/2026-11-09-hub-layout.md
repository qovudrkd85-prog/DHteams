# 화면 구조 개편 (팀 방 / 내 정비실 / 힐링 장소) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** 6방 게임 화면을 업무 중심 2화면(팀 방·정비실) + 힐링 장소 화면으로 바꾼다. DB 변경 없음.

**Architecture:** page.tsx 가 `HubView`("team" | "garage") 탭 하나로 갈래. 팀 방 = 달력 인라인 + `TeamRoomMini`(팀의 첫 office 배치도 1개, 책상 격자, 앉기/일어나기). 정비실 = TeamPanel + 개인 일정 달력 + 힐링 단추 → `HealingPlace`(파노라마 + 내 캐릭터 + 동작 4개). 순수 로직은 `src/lib/team/rooms.ts` 에 두고 test:data 로 시험.

**Tech Stack:** Next 16, React, CSS modules, node vm 시험(tests/*.cjs), Playwright node 스크립트(tests/game-world.cjs 등).

**고정 결정**
- 팀 없음 → 기존 TeamGate 그대로(개인 일정도 team RLS 아래라 DB 변경 없이 정비실만 열 수 없음).
- 입구 = 탭 2개가 기존 방 nav 6개를 대체(입구 수 감소).
- 팀 방 미니뷰: 걷기·포털·꾸미기·배치도 추가/삭제 없음. 책상 클릭 X, 단추 2개(자리에 앉기/일어나기).
- 내 책상 없으면 "자리에 앉기" 때 격자 빈칸에 책상 추가 저장 → claimOfficeSeat → sit.
- 옛 `TeamOffice`·`CalendarLauncher` 는 화면에서만 뗀다(파일 삭제는 사장 승인 뒤).

---

### Task 1: 순수 로직 `rooms.ts` + 시험 (①②의 바탕)

**Files:** Create `src/lib/team/rooms.ts`, `tests/rooms.cjs`; Modify `package.json` test:data 에 `node tests/rooms.cjs` 추가.

- [ ] `tests/rooms.cjs` 먼저(healing.cjs 와 같은 transpile+vm 방식):
  - `loadHubView()` 기본 "team", `saveHubView("garage")` 뒤 "garage", 잘못된 값 → "team".
  - `pickTeamRoom([])` null; outdoor·cafe·office-2·office-1 섞으면 room_key "office-1"; room_key 없는 office 만 있으면 첫 office.
  - `deskSlots(1000, 560)` 길이 ≥ 8, 모든 칸이 경계 안(x 90..w-90, y 100..h-90), 겹침 없음(간격 ≥ 150).
  - `withOwnDesk(layout, "m1")`: 이미 m1 책상 → `{ draft: null, deskId }`; 없고 빈 책상 있으면 그 빈 책상 id(추가 없음); 빈 책상도 없으면 빈 격자칸에 desk 1개 추가된 draft + 새 id; 격자 꽉 참 → 캔버스 키워 2400x1200 까지, 그래도 없으면 throw "책상 자리가 없어요".
- [ ] 실행: `node tests/rooms.cjs` → FAIL(파일 없음).
- [ ] `rooms.ts` 구현(`import type` 만 사용, crypto.randomUUID 로 id).
- [ ] 실행 PASS → 커밋 `feat: hub room helpers`.

### Task 2: ① 입구 탭 + ② 팀 방

**Files:** Create `src/components/team/hub-tabs.tsx`, `src/components/team/team-room.tsx`(+ `team-room.module.css`); Modify `src/app/page.tsx`, `src/components/team/office.tsx`(FurnitureArt export 만).

- [ ] page.tsx: `const [view, setView] = useState<HubView>("team")` + mount 때 `loadHubView()`. 헤더 아래 `HubTabs`. `view==="team"`: 그리드 `[minmax(0,1fr)_340px]` 왼쪽 `<section data-testid="team-calendar-inline"><DepartmentCalendar .../></section>`, 오른쪽 `<TeamRoomMini/>` + 과업 목록. CalendarLauncher·TeamOffice 쓰지 않음.
- [ ] TeamRoomMini: `listOfficeLayouts()` → `pickTeamRoom`, 3 초 새로고침(office.tsx 패턴), `useOfficePresence({ paused: false })`, svg viewBox 전체 보기(가로 100%), 책상마다 FurnitureArt + 이름표, 앉은 사람만 캐릭터, 걷는 사람은 그리지 않고 상단 띠 "지금 접속: 아바타 목록". 단추: 내 책상 앉음 아니면 "자리에 앉기"(withOwnDesk→saveOfficeLayout→claimOfficeSeat→sit), 앉았으면 "일어나기". 오류는 role=alert.
- [ ] build → 전용 playwright 스크립트로 스샷 확인 → 커밋 `feat: team room hub`. 핑퐁 1판.

### Task 3: ③ 정비실

**Files:** Create `src/components/team/garage.tsx`; Modify `page.tsx`, `department-calendar.tsx`(prop `fixedScope?: "private"` → scopeFilter 초기값·필터 단추 숨김·새 일정 기본 private).

- [ ] `view==="garage"`: 왼쪽 `Garage`(내 카드 TeamPanel + 개인 일정 달력 fixedScope private), 오른쪽 "힐링 타임 나가기" 카드 1개. 커밋 `feat: personal garage`.

### Task 4: ④ 힐링 장소 화면

**Files:** Create `src/components/team/healing/healing-place.tsx`; Modify `src/lib/team/healing.ts`(`HEALING_ACTIVITIES` 4개: laptop·fishing·walk·rest, 장소별 허용 동작 `activitiesFor(sceneId)`), `tests/healing.cjs`, `healing.module.css`, `garage.tsx`.

- [ ] 시험 먼저: `activitiesFor("fishing")` 에 fishing 포함, `activitiesFor("rooftop")` 에 fishing 없음, 모든 장소에 laptop·rest.
- [ ] HealingPlace: 정비실 영역을 대체(오버레이 X). 장소 칩(기존 overlay 의 장소·날씨 추천·타이머 재사용) + PanoramaViewer 배경 + 하단 내 캐릭터(아바타+CSS 애니메이션 data-activity) + 동작 단추 + "돌아오기"(Esc 동일). 커밋 `feat: healing place scene`.

### Task 5: ⑤ 정리·시험

**Files:** Modify `tests/game-world.cjs`, `tests/team-workspace.cjs`/`department-dashboard.cjs`(달력 다이얼로그 → 인라인), 옛 healing 브라우저 시험.

- [ ] 브라우저 시험을 새 흐름으로: 탭 전환·기억, 팀 방 앉기→다른 계정에 앉은 캐릭터 보임, 정비실→힐링→동작→돌아오기.
- [ ] test:data → lint → tsc → build → test:server → test:browser 하나씩. 커밋 `test: hub layout flows`. 옛 office.tsx/calendar-launcher.tsx 삭제 목록 사장 확인.
