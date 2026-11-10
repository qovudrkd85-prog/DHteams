# 힐링 월드 — 걸어 다니며 쉬는 힐링 타임 (2026-11-10)

사장 지시: 사진 배경 말고 **게임처럼** — 내 캐릭터가 방향키로 걸어 옥상·바다·산에 가고, 옥상에선 담배 피우기, 바닷가에선 낚시, 산에선 등산을 **실제로 하는** 화면. 실사 사진은 이질감이 커서 버린다(마인크래프트 느낌의 블록/픽셀 그림).

## 결정
- 배경은 **코드로 그린 SVG 픽셀(블록) 장면**. AI 생성 그림·외부 사진 금지(톤 제각각, 네트워크 의존). `public/healing/*.jpg`·`panorama-viewer.tsx` 는 완성 뒤 삭제(목록 보여주고 사장 확인 후).
- 걷기 엔진은 `use-office-presence.ts` 의 방식(키맵 12행, 속도 160, rAF 보간 140~165행)을 **힐링 전용 로컬 상태로 복제**한다. 서버 presence 저장 없음(힐링은 개인·클라이언트 전용).
- 입구 안 늘림: 들어가는 길은 지금처럼 정비실 "힐링 타임" 카드 하나. 장소 칩·시간 칩·Esc·날씨·상태메시지 세션(`startHealingStatus`)은 그대로.
- DB 변경 없음.

## 공통 계약 (에이전트 셋이 같은 숫자를 쓴다)
- 논리 좌표: 장면마다 **1600×900**. 캐릭터 위치 `{x, y}` 는 발 위치.
- 장면 id: 기존 6개(`beach`·`fishing`·`mountain`·`rooftop`·`rooftop-night`·`snow-forest`) + 허브 `yard`(쉼터 마당). 허브에서 각 장소 입구(portal)로 걸어 들어가고, 장소마다 `yard` 로 돌아오는 입구가 있다.
- 소품(prop) 종류: `fishing`(낚싯대 자리) · `smoke`(옥상 난간 재떨이) · `hike`(등산로 체크포인트, 산에 3개 → 마지막이 정상 깃발) · `bench`(쉬기) · `laptop`(책상) · `stargaze`(밤옥상 망원경) · `snowman`(눈숲) · `portal`(장면 이동, `to`).
- 동작(activity) id: 기존 `laptop`·`fishing`·`walk`·`rest` + 새 `smoke`·`hike`·`stargaze`·`snowman`. 소품 → 동작 대응은 `healing-world.ts` 가 가짐.
- 입력: 방향키·WASD 로 걷기, 소품에 닿으면 **자동으로** 그 동작 시작(버튼 없이), 떠나면 끝. 포털에 서면 0.3초 뒤 장면 전환. 모바일: 장면을 탭하면 그 지점까지 걸어감. 기존 동작 버튼 줄은 유지(시험·접근성 — 버튼을 누르면 캐릭터가 그 소품으로 걸어간다).
- 날씨 효과(`WeatherEffects` 비·눈·안개)와 낮/밤은 장면 위에 그대로 겹친다. 장면 컴포넌트는 `isDay`·`effect` prop 만 받아 하늘색·조명을 바꾼다.

## 파일 분담 (병렬 가능 = 서로 다른 파일)
### A. 그림 — `src/components/team/healing/scenes/*.tsx` (프론트 디자인 에이전트, `frontend-design` 스킬)
- `yard.tsx`, `beach.tsx`, `fishing.tsx`, `mountain.tsx`, `rooftop.tsx`, `rooftop-night.tsx`, `snow-forest.tsx` + `index.ts`(`SCENE_ART: Record<HealingSceneId | "yard", ComponentType<SceneArtProps>>`).
- `SceneArtProps = { isDay: boolean; effect: WeatherEffect }`. 순수 표시용 SVG, `viewBox="0 0 1600 900"`, `preserveAspectRatio="xMidYMid slice"`, 로직·상태 없음, `<img>` 금지.
- 픽셀/블록 그림체: 큰 사각 타일(32~64 단위), 평면색, 팀 방 `world-art.tsx` 와 같은 채도. 소품이 놓일 자리(아래 B 의 좌표)는 바닥을 비워 두고, 소품 그림 자체는 B/C 가 그린다(좌표 어긋남 방지).
- 먼저 **정적 미리보기**: `E:\개인 FIle\01_Projects\_scratch\dh-teams\scene_preview.html` 류로 7장면을 한 페이지에 띄워 사장 확인(수 초 수정 루프). 통과 후 연결.

### B. 로직 — `src/lib/team/healing-world.ts` + `tests/healing.cjs` 추가 (TDD 에이전트)
- 타입: `Rect`, `HealingProp {id, kind, x, y, w, h, label, to?}`, `HealingWorldScene {id, spawn, walkable: Rect[], props}`.
- 데이터: `HEALING_WORLD: Record<HealingSceneId | "yard", HealingWorldScene>` — 소품·입구·걸을 수 있는 바닥 좌표(1600×900). 산은 `hike` 체크포인트 3개가 위로 올라가는 길.
- 함수(순수): `stepCharacter(scene, pos, dir, dt)`(속도 160/s, walkable 밖이면 멈춤), `walkToward(scene, pos, target, dt)`(탭 이동), `propAt(scene, pos)`(발 위치가 소품 상자 안), `activityForProp(kind)`, `portalAt(scene, pos)`, `hikeProgress(scene, visited: string[])`(0~3, 3=정상).
- 시험 먼저(RED→GREEN): 벽 밖으로 못 나감, 소품 위에서 동작 판정, 포털 전환, 등산 3단계, 자유 글자 없음.

### C. 연결 — `healing-place.tsx`·`healing-overlay.tsx`·`healing.ts`·`game-world.cjs` (메인 세션, A·B 끝난 뒤)
- `healing.ts`: `HealingActivityId` 에 새 동작 추가, `activitiesFor` 는 장면의 소품에서 유도. `image` 필드 삭제.
- `healing-overlay.tsx`: `PanoramaViewer`·`healing-preview` 제거 → `SCENE_ART[sceneId]` + 캐릭터 레이어(`WalkingCharacter` 재사용) + 소품 레이어. 허브 `yard` 시작, 포털로 전환. 안내 문구 "방향키로 걷기 · 소품에 가면 시작 · Esc 닫기".
- `healing-place.tsx`: 키 입력(방향키·WASD, 입력창 포커스 땐 무시), rAF 루프, 탭 이동, 소품 자동 동작, 동작 버튼 = 그 소품으로 걷기. `data-testid` 유지: `healing-place`, `healing-avatar`(`data-activity`), `healing-activity-<id>`, 새 `healing-scene`(`data-scene`), `healing-prop-<id>`.
- `game-world.cjs` 힐링 구간: 정비실 → 힐링(yard) → 바닷가 포털까지 방향키 → `data-scene=beach` → 낚싯대까지 → `data-activity=fishing` → Esc 복귀·상태 복구. 모바일 폭 탭 이동 1회.
- 사본 빌드 + hub_check 스샷 + **사장 창 열기**(3014) → 핑퐁 1판 → `feat: healing world` 커밋 → 삭제 목록(jpg 6장 5.3MB, panorama-viewer.tsx) 보여주고 대기.

## 완료 기준
- test:data(healing.cjs 포함) PASS, lint 0, 사본 build PASS, game-world PASS, hub_check 스샷에 걷는 캐릭터+픽셀 장면, 사장이 창에서 확인.

## 위험
- 키 입력이 달력 단축키·Esc 와 겹침 → 힐링 영역 안 포커스일 때만 처리(T4-R1 Esc 규칙과 같게).
- 모바일 탭 이동과 스크롤 충돌 → 장면 안 터치는 `touch-action: none`.
- 빌드 메모리: 세션 많으면 exit 134 → `NEXT_BUILD_CPUS=2`, 다른 무거운 검사와 겹치지 말 것.

## 좌표표 (확정 — A·B·C 공통, 11-10)
논리 좌표 1600×900. 사각형은 전부 `{x, y, w, h}` = **왼쪽 위 모서리 + 크기**. 캐릭터 위치는 발 위치. `walkable` 은 발이 들어갈 수 있는 바닥 사각형들(합집합). 소품 `propAt` 판정 = 발 위치가 소품 사각형 안. A 는 아래 소품 사각형 자리의 바닥을 비워 둔다(소품 그림은 C 가 그 사각형 위에 올림).

| scene | spawn | walkable | props (id · kind · x,y,w,h · label · to) |
|---|---|---|---|
| yard | 800,780 | 80,560,1440,300 | to-beach·portal·130,560,140,90·바닷가·beach / to-fishing·portal·370,560,140,90·낚시터·fishing / to-mountain·portal·610,560,140,90·산·mountain / to-rooftop·portal·850,560,140,90·옥상·rooftop / to-rooftop-night·portal·1090,560,140,90·밤 옥상·rooftop-night / to-snow-forest·portal·1330,560,140,90·눈 숲·snow-forest / bench·bench·720,760,160,80·벤치 |
| beach | 300,760 | 0,520,1600,360 | bench·bench·1020,720,160,80·파라솔 의자 / to-yard·portal·50,780,140,90·마당으로·yard |
| fishing | 320,720 | 200,600,1200,200 | fishing·fishing·1190,650,120,100·낚싯대 / bench·bench·620,700,160,80·잔교 의자 / to-yard·portal·170,735,140,90·마당으로·yard |
| mountain | 300,820 | 100,740,1400,140 + 700,560,800,200 + 300,380,800,200 + 500,220,500,180 | hike-1·hike·1140,605,120,90·쉼터 1 / hike-2·hike·540,425,120,90·쉼터 2 / hike-3·hike·690,250,140,100·정상 깃발 / to-yard·portal·90,795,140,90·마당으로·yard |
| rooftop | 800,760 | 80,520,1440,340 | smoke·smoke·1320,550,120,100·난간 재떨이 / laptop·laptop·420,570,160,100·옥상 책상 / bench·bench·820,760,160,80·벤치 / to-yard·portal·90,775,140,90·마당으로·yard |
| rooftop-night | 800,760 | 80,520,1440,340 | stargaze·stargaze·1230,545,140,110·망원경 / smoke·smoke·240,550,120,100·난간 재떨이 / bench·bench·720,760,160,80·벤치 / to-yard·portal·90,775,140,90·마당으로·yard |
| snow-forest | 300,780 | 100,540,1400,340 | snowman·snowman·1130,620,140,120·눈사람 / bench·bench·620,760,160,80·통나무 의자 / to-yard·portal·90,795,140,90·마당으로·yard |

- `hikeProgress`: visited 에 hike-1·hike-2·hike-3 이 순서대로 들어온 개수(0~3). 3 = 정상. 순서가 어긋나면 그 지점은 세지 않는다.
- kind → activity: fishing→fishing, smoke→smoke, hike→hike, bench→rest, laptop→laptop, stargaze→stargaze, snowman→snowman, portal→(동작 없음, 전환). 소품 밖에서 움직이면 `walk`, 서 있으면 동작 없음(null).
- 속도 160/s. `stepCharacter` 는 x·y 를 따로 시도해 벽을 따라 미끄러진다(한 축이 막혀도 다른 축은 이동).
- 시험 로더: tests/healing.cjs 는 `ts.transpileModule` + `vm.runInNewContext` 로 **파일 하나만** 돌린다 → healing-world.ts 는 값 import 금지(`import type` 만). healing.ts 쪽에서 healing-world 를 쓰는 건 C 단계에서 결정.

## 변경 (11-10 오후, 사장 요청) — 한 장의 넓은 연속 세계
- 사장: "너무 좁다. 드넓게 이동, 한곳에 국한되지 않게, 아무 생각 없이 쭉 걷다가 앉아서 낚시" + "캠핑장(불멍) 추가".
- 구조: 구역 그림(1600x900)은 그대로 두고 `healing-world.ts` 의 `WORLD_ZONES` 로 가로로 이어 붙인 **하나의 세계** `WORLD`(평탄화, prop id `zone:prop`). 이웃 구역의 바닥이 맞닿으면(가장자리 200 안, 겹치는 높이 80 이상) 자동 다리(`bridges`)로 이어져 포털 없이 걸어서 넘어간다. 카메라(viewBox 1600x900)가 캐릭터를 따라감(x 는 부드럽게, y 는 구역 행).
- 배치(왼→오): beach · fishing · **yard(시작)** · camp · mountain · snow-forest. rooftop 은 2행(y=900, 마당 아래): 마당 "옥상" 문 ↔ 옥상 계단실로만 오르내림(야외 땅과 안 이어짐).
- 마당 문 6개는 지름길(텔레포트)로 유지. "밤 옥상" 장면은 삭제 — 낮/밤은 날씨 시각으로 세계 전체에 걸리므로 옥상 그림을 `isDay` 로 갈아끼움(`scenes/index.ts` RooftopDayNightArt). 그 문(x1090)은 캠핑장 문이 됨. 밤 날씨 추천 장소 = camp(불멍).
- 속도 WALK_SPEED 160→240(구역 하나 약 7초). 소품 라벨·이모지는 `healing-world.tsx` 소품 레이어가 그림 위에 그림(그림 안 좌표와 조금 어긋나도 허용).
- 남은 한계: 구역 경계는 하늘색이 달라 마스크 크로스페이드(192유닛)로 섞음. 옥상 망원경은 낮 그림에 없음(소품 레이어 이모지만).

| scene | spawn | walkable | props (id · kind · x,y,w,h · label · to) |
|---|---|---|---|
| camp | 300,780 | 100,540,1400,340 | campfire·campfire·720,640,160,120·모닥불 / bench·bench·1100,740,160,80·통나무 의자 / to-yard·portal·90,795,140,90·마당으로·yard |
| rooftop(합침) | 800,760 | 80,520,1440,340 | smoke 1320,550,120,100 / laptop 420,570,160,100 / bench 820,760,160,80 / stargaze·stargaze·1040,545,140,110·망원경 / to-yard 90,775,140,90 |
| yard 문 | | | to-camp·portal·1090,560,140,90·캠핑장·camp (옛 to-rooftop-night 자리) |
