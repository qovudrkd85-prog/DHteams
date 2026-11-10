# Fable 설계 요약 (11-10) — 실행은 Opus

## A. LOW 3건 (진행 중, 코드 끝·검증 전)
- U1 지난 마감 D+: lib/project-deadlines.ts `badgeDeadlineByProject`(지난 미완료 가장 오래된 것 우선, 없으면 다음 마감), filter.tsx 조회 today-30~+60, 배지 rose + data-overdue.
- U2 focus 링크 탭 기억: page.tsx `focusView` 일회성 state, `view = focusView ?? savedView`, 탭 클릭 시 null. localStorage 덮지 않음.
- U3 이달 건수: department-calendar.tsx monthCount — filter=deadline 이면 팀 일정 0 + projectFilter 반영.
- 시험: department-dashboard.cjs s5(p2 지난 done)·s6(p2 지난 open → "D+1지평 밀린 보고"), p3 선택 시 "이달의 일정 1건", focus 뒤 localStorage garage 유지.

## B. 과업 달력 → 팀 달력 검토 (결론)
- 과업 일정은 schedules 한 종류뿐, 팀 달력이 삭제분 빼고 전부 가져옴(완료는 취소선). 종류 단위 누락 없음.
- 화면에서 사라지는 경우: 종류 칩 선택(:240), "나만 보기"(:240), 등록자 필터는 assignee 글자 완전일치만(:243, project-deadlines.ts:78-88 — 담당자 빈칸·오타 사라짐), 칸당 3줄.
- 팀 구분은 RLS(supabase/schema-teams.sql:64-71, 231-232)만 — 실DB 적용 미확인. team_id null 옛 과업은 아무에게도 안 보임.
- note·월 메모는 팀 달력에 안 나옴. 기간 일정 없음(DB 필요).
- 추천 작업: (1) 새 파일 components/team/month-deadline-list.tsx — 이달 과업 일정 과업별 묶음 목록(이미 불러온 deadlines 재사용), (2) "내 일정"에 담당자 없는 과업 일정 유지 + trim [사장 판단], (3) 종류 칩으로 숨겨지면 "과업 일정 n건 숨김 · 보기", (4)[선택] 500건 range 반복.

## C. 힐링 장면 품질 (산·바다)
- 현재: 순수 SVG rect 단색·계단 능선·체커 바닥·야자수 해변, 밤 덮개 이중(healing-world.tsx:260 + 장면 shade). panorama-viewer.tsx·public/healing jpg 6장은 참조 0(삭제 후보 그대로).
- 추천: 사진 말고 SVG 유지, 곡선 path+그라데이션+겹능선+파도 여러 겹. 북한산 화강암 돔 / 동해(해송·등대·방파제). filter(blur/turbulence) 금지, 장면당 요소 450 이하, 그라데이션 id 는 `${zone}-` 접두.
- 순서: U1 scenes/paint.tsx 공용 도구(Floors 는 HEALING_WORLD walkable 에서) → U2 mountain.tsx → 스샷 사장 확인 → U3 beach.tsx → U4 밤 덮개 1개·reduced-motion → U5 game-world.cjs 단언(gradient≥2, path≥12, filter 0, id 중복 0, data-floor=walkable, 390·1280 pageerror 0) → U6 나머지 5곳.
- 위험: 벡터 한계로 "퀄리티" 부족 판정 가능(2안: 먼 배경 CC0 사진, 내려받기 승인 필요), 폰은 1600 중 ~500폭만 보임 → 볼거리 500 간격.
