const { getClient } = require('./ai');

const DEFAULT_MODEL = 'gpt-6-luna';
const model = () => process.env.OPENAI_MODEL || DEFAULT_MODEL;

const MAX_CHAT = 40000;
const MAX_MENU_TEXT = 8000;
const MAX_MENU_ITEMS = 300;

const fail = (status, message) => Object.assign(new Error(message), { status });

const format = (name, schema) => ({ type: 'json_schema', name, strict: true, schema });

const menuSchema = {
  type: 'object',
  properties: {
    menu: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, price: { type: ['integer', 'null'] } },
        required: ['name', 'price'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['menu', 'notes'],
  additionalProperties: false,
};

const ordersSchema = {
  type: 'object',
  properties: {
    unit: { type: 'string' },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          orders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                menuIndex: { type: 'integer' },
                label: { type: 'string' },
                qty: { type: 'integer' },
                option: { type: ['string', 'null'] },
              },
              required: ['menuIndex', 'label', 'qty', 'option'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'orders'],
        additionalProperties: false,
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { person: { type: ['string', 'null'] }, message: { type: 'string' } },
        required: ['person', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['unit', 'people', 'issues'],
  additionalProperties: false,
};

const MENU_RULES = `너는 한국어 메뉴판/가격표를 읽는 도우미다.
- 보이는 모든 메뉴를 빠짐없이 뽑는다. name 은 적힌 그대로(온도·사이즈 구분이 있으면 '아메리카노(아이스)', '탕수육(소)' 처럼 항목마다 따로).
- 한 줄에 온도/사이즈별 가격이 여러 개면 각각 다른 항목으로 나눈다.
- price 는 원 단위 정수(쉼표·'원' 없이). 가격이 안 보이거나 불확실하면 null. 추측해서 만들지 않는다.
- 메뉴가 아닌 글(영업시간·안내)은 무시하고, 읽기 어려웠던 점만 notes 에 짧게 적는다.`;

const ORDER_RULES = `너는 카카오톡 단체 주문방 대화를 정리하는 도우미다. 입력은 채팅방을 통째로 복사한 글이다.
('[이름] [오후 3:05] 내용', '이름: 내용', '2025년 1월 1일 오후 3:05, 이름 : 내용' 등 형식이 섞일 수 있다.)

목표: 대화가 끝난 시점에 사람마다 "최종적으로 무엇을 몇 개 주문했는지"를 만든다.
1. 메시지를 시간 순서대로 읽고 뒤의 취소·변경·수량 수정을 앞의 주문에 반영한다.
   - '○개로 줄일게요/바꿔요/다시 변경' 은 수량을 ○로 확정(절대값)한다.
   - '한 잔 취소', '하나 빼주세요' 는 그만큼 뺀다. '취소할게요' 만 있으면 그 메뉴 전체를 뺀다.
   - '라떼로 변경' 처럼 메뉴를 바꾸면 이전 메뉴를 새 메뉴로 교체한다(수량 유지).
   - '저도요', '같은 걸로', '위와 동일' 은 바로 앞 사람의 주문을 따른다.
2. 주문이 아닌 말(인사·공지·마감 안내·잡담)은 무시한다. 최종 주문이 하나도 없는 사람은 people 에 넣지 않는다.
   방을 연 총무가 직접 주문했다면 그 사람도 포함한다.
3. 같은 사람이 여러 번 말해도 한 명으로 합친다. 이름은 대화에 나온 표기를 쓰고(직함·괄호 제외) 새 이름을 만들지 않는다.
4. 메뉴 매칭: 아래 번호 메뉴판이 있으면 각 주문의 menuIndex 에 가장 알맞은 번호를 넣는다.
   은어 예: 아아=아이스 아메리카노, 뜨아=따뜻한 아메리카노, 아바라/얼죽아=아이스, 라떼=카페라떼, 짬짜면 같은 조합은 메뉴판에 있을 때만.
   사이즈·온도가 말에 없고 메뉴판에 여러 개면 가장 기본인 것(없으면 -1)을 쓰고 issues 에 적는다.
   메뉴판에 없거나 확신이 없으면 menuIndex=-1 로 두고 issues 에 적는다. 메뉴판이 없으면 모두 -1.
5. label 은 사람이 말한 이름을 깔끔히 다듬은 것(메뉴판에 맞췄다면 그 메뉴 이름). qty 는 1 이상 정수.
   option 은 '샷 추가', '덜 달게', '얼음 적게' 같은 요청이 있을 때만(없으면 null). 온도·사이즈는 메뉴 선택으로 해결하고 option 에 넣지 않는다.
6. unit 은 이 주문에 자연스러운 세는 단위 한 단어('잔','개','인분','마리' 등).
7. 애매하거나 해석이 갈리는 부분은 가장 그럴듯한 쪽으로 정한 뒤 issues 에 사람 이름과 함께 한 줄씩 적는다(예: '도윤: "라떼로 변경" 이 남은 2잔 전부인지 불분명해 2잔 모두 변경으로 처리').
   없는 내용을 지어내지 않는다.`;

async function callModel(client, { instructions, content, fmt, effort }) {
  let res;
  try {
    res = await client.responses.create({
      model: model(),
      reasoning: { effort },
      instructions,
      input: [{ role: 'user', content }],
      text: { format: fmt },
    });
  } catch (err) {
    if (err && (err.code === 'model_not_found' || err.status === 404)) {
      throw fail(502, `모델 '${model()}' 을(를) 쓸 수 없어요. .env 의 OPENAI_MODEL 을 확인하세요.`);
    }
    throw err;
  }
  try {
    return JSON.parse(res.output_text);
  } catch {
    throw fail(502, '모델이 읽을 수 있는 결과를 돌려주지 않았어요. 다시 시도해 주세요.');
  }
}

function cleanMenu(list) {
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const name = String((m && m.name) || '').trim().slice(0, 60);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const price = Number.isFinite(m.price) && m.price >= 0 ? Math.round(m.price) : null;
    out.push({ name, price });
    if (out.length >= MAX_MENU_ITEMS) break;
  }
  return out;
}

async function parseMenu({ text, image }, client = getClient()) {
  if (!client) throw fail(503, '서버에 OPENAI_API_KEY 가 없어요. .env 를 확인하세요.');
  const content = [];
  if (text) content.push({ type: 'input_text', text: text.slice(0, MAX_MENU_TEXT) });
  if (image) {
    content.push({ type: 'input_text', text: '아래 사진의 메뉴판에서 메뉴와 가격을 뽑아 주세요.' });
    content.push({ type: 'input_image', image_url: image, detail: 'high' });
  }
  const r = await callModel(client, { instructions: MENU_RULES, content, fmt: format('menu_parse', menuSchema), effort: 'low' });
  return { menu: cleanMenu(r.menu), notes: String(r.notes || '') };
}

// 모델이 돌려준 값을 믿지 않고 범위·형식을 다시 확인한다.
function cleanOrders(raw, menu) {
  const byName = new Map();
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    const name = String((p && p.name) || '').trim().slice(0, 40);
    if (!name) continue;
    const person = byName.get(name) || { name, orders: [] };
    for (const o of Array.isArray(p.orders) ? p.orders : []) {
      const qty = Math.min(99, Math.max(0, Math.round(Number(o.qty) || 0)));
      if (!qty) continue;
      const idx = Number.isInteger(o.menuIndex) && o.menuIndex >= 0 && o.menuIndex < menu.length ? o.menuIndex : -1;
      const label = (idx >= 0 ? menu[idx].name : String(o.label || '').trim()).slice(0, 60);
      if (!label) continue;
      const option = o.option ? String(o.option).trim().slice(0, 40) : '';
      const dup = person.orders.find((x) => x.menuIndex === idx && x.label === label && x.option === option);
      if (dup) dup.qty = Math.min(99, dup.qty + qty);
      else person.orders.push({ menuIndex: idx, label, qty, option });
    }
    if (person.orders.length) byName.set(name, person);
  }
  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((i) => ({ person: i && i.person ? String(i.person).slice(0, 40) : null, message: String((i && i.message) || '').slice(0, 300) }))
    .filter((i) => i.message)
    .slice(0, 30);
  return { unit: String(raw.unit || '개').trim().slice(0, 6) || '개', people: [...byName.values()], issues };
}

// 채팅 + (메뉴 글 | 메뉴 사진 | 이미 읽은 메뉴) → 명단·주문·메뉴 매칭
async function analyze({ chat, menuText, menuImage, menu: givenMenu }, client = getClient()) {
  if (!client) throw fail(503, '서버에 OPENAI_API_KEY 가 없어요. .env 를 확인하세요.');
  let menu = cleanMenu(givenMenu);
  let menuNotes = '';
  if (!menu.length && (menuText || menuImage)) {
    const parsed = await parseMenu({ text: menuText, image: menuImage }, client);
    menu = parsed.menu;
    menuNotes = parsed.notes;
  }
  const menuList = menu.length
    ? menu.map((m, i) => `${i}. ${m.name}${m.price == null ? '' : ` — ${m.price}원`}`).join('\n')
    : '(메뉴판 없음 — 모든 menuIndex 는 -1)';
  const raw = await callModel(client, {
    instructions: `${ORDER_RULES}\n\n[메뉴판]\n${menuList}`,
    content: [{ type: 'input_text', text: chat.slice(0, MAX_CHAT) }],
    fmt: format('order_analysis', ordersSchema),
    effort: process.env.ORDER_REASONING || 'medium',
  });
  const cleaned = cleanOrders(raw, menu);
  if (menuNotes) cleaned.issues.unshift({ person: null, message: `메뉴판: ${menuNotes}` });
  return { menu, ...cleaned };
}

module.exports = { analyze, parseMenu, cleanOrders, cleanMenu, DEFAULT_MODEL, MAX_CHAT, MAX_MENU_TEXT };
