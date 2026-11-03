# chongmu

Trip Splitter is a static HTML, CSS and JavaScript app. No build step is required.

## UI

The section order, two-column grid, 980px stacking breakpoint and account form
layout are unchanged. Component tokens live in `styles.css`; `ui.js` contains
loading-state and dialog-motion helpers. Motion respects `prefers-reduced-motion`.

The following references are adapted to native HTML/CSS, not installed as React
dependencies:

- [shadcn/ui](https://ui.shadcn.com/docs/components/button): button variants, input borders and focus rings.
- [Arc UI](https://uiarc.dev/components/dialog): focused dialogs and quiet interaction states.
- [affectUI](https://www.affectui.com/components/button): readable pending actions with stable button dimensions.
- [Transitions.dev](https://transitions.dev/): short scale/fade dialog transitions and restrained state motion.

Pretendard Variable is self-hosted in `assets/fonts` under the included SIL Open
Font License. Lucide icons are in `assets/icons` with their ISC license.

## 총무해방 서버 · AI

여행 총무를 위한 정산 앱. 참가자·지출을 넣으면 누가 누구에게 얼마를 주면 되는지 바로 계산하고,
AI(GPT)로 **영수증·메뉴판·주문 사진**, **붙여 넣은 주문 글**을 지출로 읽어 넣거나 **정산을 설명**해 줍니다.

### 실행

```bash
npm install
cp .env.example .env      # OPENAI_API_KEY 를 채운다
npm start                 # http://localhost:8080
```

개발 중에는 `npm run dev`(파일이 바뀌면 서버 재시작).

### 환경 변수 (.env)

| 이름 | 필수 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | AI 기능 예 | OpenAI API 키. **서버에만 두고 브라우저로 내려보내지 않음** |
| `OPENAI_MODEL` | 아니오 | 기본 `gpt-6.1-sol` |
| `OPENAI_REASONING` | 아니오 | `low`(기본) · `medium` · `high` |
| `OPENAI_BASE_URL` | 아니오 | 프록시·게이트웨이를 쓸 때 |
| `PORT` | 아니오 | 기본 8080 |
| `AI_RATE_PER_MIN` | 아니오 | IP당 AI 요청 분당 한도(기본 20) |
| `AI_TIMEOUT_MS` | 아니오 | AI 응답 제한 시간(기본 60초) |

키가 없어도 앱은 돌아갑니다(정산만 되고 AI 칸은 "키 없음" 안내).

### API (모두 JSON, POST)

| 주소 | 보내는 값 | 돌려주는 값 |
|---|---|---|
| `GET /api/health` | — | `{ok, keyConfigured, model}` |
| `POST /api/receipt` | `{image: dataURL}` | 영수증 1건 `{isExpense, expense, note}` |
| `POST /api/menu-image` | `{image: dataURL}` | 메뉴판·주문 항목들 `{expenses[], notes}` |
| `POST /api/orders-text` | `{text, participants[]}` | 글에서 뽑은 지출들 `{expenses[], notes}` |
| `POST /api/summarize` | `{state}` | 정산 설명 `{summary, perPerson[], transfers[], tips[]}` |
| `POST /api/chat` | `{messages[{role,content}], state}` | `{reply}` |

`state` 는 화면이 보내는 정산 데이터(참가자별 지불·부담·순액, 지출, 최소 송금 목록)입니다.
AI는 구조화 출력(JSON Schema)으로 받아 형식이 어긋나지 않습니다. 사진은 브라우저에서 긴 변 1600px JPEG로 줄여 보냅니다.

### Firebase (선택)

`firebase-config.js` 로 로그인·세션 공유를 켜 둡니다. Firestore 보안 규칙 예시는 [firestore.rules](firestore.rules).

### 카톡 주문 정리 (`/order.html`)

단톡방 주문 대화를 통째로 붙여 넣고 메뉴판(가격표 글 또는 사진)을 넣으면, 취소·변경을 반영한 사람별 최종 주문을
메뉴판과 매칭해 금액까지 계산하고 카톡에 붙여 넣을 글로 만듭니다.

- AI(`POST /api/order/analyze`)는 "누가 무엇을 몇 개"와 메뉴 번호 매칭만 읽고, **금액·합계·양식은 코드가 계산**합니다(`order-core.js`).
- 결과 화면에서 메뉴·수량을 고치면 카톡 글이 바로 다시 만들어집니다.
- 모델은 `OPENAI_MODEL`(기본 `gpt-6-luna`), 주문 분석 추론 강도는 `ORDER_REASONING`(기본 `medium`).
- 예시: 화면의 "예시 넣기"(`testdata/chat-*.txt`, `menu-*.txt`).
