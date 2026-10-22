# AI 에이전트 플레이

`index.html`을 연 뒤 페이지 JavaScript에서 `window.GameAgent`를 사용합니다.
서버·설치·화면 좌표 추측 없이 `file://`에서도 동작합니다.

```js
let state = GameAgent.observe();
const start = state.actions.find(a => a.name === '조조 세력으로 시작');
let result = GameAgent.act({ revision: state.revision, id: start.id });

state = result.observation;
result = GameAgent.act({ revision: state.revision, id: 'city:허창' });
state = result.observation;
const develop = state.actions.find(a => a.name === '개발');
result = GameAgent.act({ revision: state.revision, id: develop.id });
// 이어서 actions의 무장 선택 버튼 → 확인 버튼을 실행합니다.
```

## 관찰

`GameAgent.observe()`는 원본 상태와 분리된 JSON 직렬화 가능 객체를 반환합니다.

| 필드 | 의미 |
|---|---|
| `version`, `revision` | API 버전과 관찰 번호. 행동할 때 최신 revision을 전달합니다. |
| `phase` | `title`, `strategy`, `battle`, `gameOver` |
| `status` | `ready`, `waiting`, `finished` |
| `strategy` | 날짜, 명령권, 선택 도시, 세력, 모든 도시·연결·수입·병력 상한, 등장한 무장, 최근 기록 |
| `battle` | 라운드, 차례, 선택 부대 ID, 모드, 부대 상태, 117개 칸의 지형·성 점유·가능한 행동, 원군, 최근 기록 |
| `dialog` | 현재 대화상자의 제목과 본문. 없으면 `null` |
| `message` | 현재 화면에 표시되는 결과/실패 안내 |
| `controls` | 현재 UI 컨트롤. 비활성 여부·힌트·입력값·범위·선택지 포함 |
| `actions` | 지금 조작할 수 있는 컨트롤 및 도시/전장 칸 |

아직 등장하지 않은 무장, 난수 상태, 내부 UI 콜백은 포함하지 않습니다.
`strategy.economy`는 세력 전체의 `goldIncome`, `goldUpkeep`, `goldNet`, `foodIncome`, `foodUpkeep`, `foodNet`을 제공합니다.
`battle.supply`는 진영별 이번 라운드 소요(`cost`), 전투 누적 소요(`total`), 누적 지급(`paid`), 잔여 비축(`food`), 이번 보급 부족 사기 손실(`moraleLoss`)을 제공합니다. 월 경제는 평시 주둔 기준이고 전투 소비는 매 라운드 별도로 차감합니다.
도시는 `goldConsumption`, `foodConsumption`, `recruited`(이번 달 징병 완료)도 포함합니다.
내정·충원 무장을 선택하면 `dialog.text`에 비용·효과 예고가 갱신되고, 자원이 부족하면 확인 버튼이 비활성화됩니다.
`battle.tiles`의 좌표는 **0부터**, 왼쪽 위가 `(0,0)`, 오른쪽 아래가 `(12,8)`입니다.
`selectedUnit`은 `units[].id`를 가리킵니다. `action: null`인 칸은 조작할 수 없습니다.
기병 돌격·보병 일제공격·불화살·계략은 먼저 해당 버튼을 고른 뒤 새 관찰에서 대상 칸을 고릅니다.

## 행동

`GameAgent.act({ revision, id, value? })`는 한 번의 UI 조작을 동기 실행합니다.

| `actions[].type` | 전달할 값 |
|---|---|
| `click` | `id` (버튼·무장 선택·목적지·목록 펼치기) |
| `city` | `id: 'city:허창'`처럼 관찰에 나오는 도시 ID |
| `tile` | `id: 'tile:3,4'`처럼 관찰에 나오는 칸 ID |
| `fill` | `value: 2000` 또는 문자열 (병력 등) |
| `select` | `value: '궁병'`처럼 `options[].value` 중 하나 |
| `check` | `value: true` 또는 `false` (자동 전투 등) |

`ui:...` ID는 페이지 실행 중 해당 DOM 컨트롤에만 유효합니다. 저장하거나 하드코딩하지 말고
매 응답의 `observation.actions`에서 다시 선택하세요. 대화상자가 열리면 그 안의 조작만 제공합니다.
입력값 변경도 한 행동이며, 다음 조작에는 변경 후의 revision을 사용합니다.

이동 명령에서 목적지를 고르는 동안에는 대화상자가 없고, `city` 행동이 **지도 클릭과 같은 경로**로 동작합니다. 인접 아군 도시만 목적지로 선택되며(그 밖의 도시는 `UNAVAILABLE_ACTION`), 목록 선택은 `이동 목적지` 띠의 [목록에서 선택] 버튼으로 합니다.

응답은 `{ ok: true, observation }` 또는 `{ ok: false, error: { code, message }, observation }`입니다.
`ok`는 UI 입력 전달 여부입니다. 등용·외교의 확률 판정, 자원 부족 등 **게임 명령의 결과**는
새 관찰의 `message`, `dialog`, `strategy.log`, `battle.log`와 실제 수치 변화로 확인합니다.

- `STALE_OBSERVATION`: 상태가 바뀌었습니다. 응답의 관찰로 다시 결정하세요.
- `UNAVAILABLE_ACTION`: 비활성·가려짐·존재하지 않는 행동입니다.
- `INVALID_VALUE`: 범위/단위 밖의 숫자나 없는 선택지입니다. 입력은 변경하지 않습니다.

월 진행·전투 행동 연출·상대 행동 중에는 `status: 'waiting'`입니다.

```js
const result = await GameAgent.waitForReady({ timeoutMs: 15000 });
const state = result.observation;
```

자동 전투 중에는 `waiting`이 유지됩니다. 수동 지휘로 돌아가려면 `actions`의
`domId: 'bAuto'` 버튼을 실행하세요. 제한시간이 지나면 `TIMEOUT`과 현재 관찰을 반환하며,
게임은 계속 진행됩니다. `timeoutMs` 허용 범위는 0~60000입니다.

## DOM으로 조작하는 에이전트

- 도시 패널 위 **도시 목록 · 이름으로 선택**을 펼치면 전체 도시를 버튼으로 선택할 수 있습니다.
- 전장 아래 **전장 목록 · 좌표로 조작**을 펼치면 지형·부대·행동이 이름에 포함된 칸별 버튼이 나옵니다.
- 세력·무장·목적지 선택 행은 `role="button"`과 키보드 Enter/Space를 지원합니다.
- 출진/원군 입력에는 무장 이름과 병과·진형·병력 라벨이 있습니다.

## 검증

기존 Node 테스트에 더해 실제 Chromium에서 관찰/조작만으로 내정·이동·저장/불러오기·월 진행·출진·전장 선택/이동을 검증합니다.
설치된 Playwright가 필요하며 새 의존성을 자동 설치하지 않습니다.

```powershell
node tools/agent_test.js
# Playwright가 다른 위치에 있다면:
$env:PLAYWRIGHT_MODULE = 'C:/path/to/node_modules/playwright'
node tools/agent_test.js
```
