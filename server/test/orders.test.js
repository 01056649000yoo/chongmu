const test = require('node:test');
const assert = require('node:assert');
const { analyze, cleanOrders } = require('../lib/orders');
const C = require('../../order-core');

const menu = [
  { name: '짬뽕', price: 9000 },
  { name: '짜장면', price: 8000 },
  { name: '군만두', price: 6000 },
];

const fakeClient = (outputs) => {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (req) => {
        calls.push(req);
        return { output_text: JSON.stringify(outputs.shift()) };
      },
    },
  };
};

test('cleanOrders validates indexes, merges people and drops empty orders', () => {
  const r = cleanOrders(
    {
      unit: '그릇',
      people: [
        { name: ' 태윤 ', orders: [{ menuIndex: 0, label: 'x', qty: 1, option: null }, { menuIndex: 9, label: '사이다', qty: 1, option: '' }] },
        { name: '태윤', orders: [{ menuIndex: 0, label: 'x', qty: 2, option: null }, { menuIndex: 1, label: '짜장', qty: 0, option: null }] },
        { name: '유령', orders: [] },
      ],
      issues: [{ person: null, message: '' }, { person: '태윤', message: '애매' }],
    },
    menu
  );
  assert.strictEqual(r.people.length, 1);
  assert.deepStrictEqual(r.people[0].orders.map((o) => [o.menuIndex, o.label, o.qty]), [[0, '짬뽕', 3], [-1, '사이다', 1]]);
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.unit, '그릇');
});

test('analyze: parses menu text first, then sends numbered menu to order step', async () => {
  const client = fakeClient([
    { menu, notes: '' },
    { unit: '개', people: [{ name: '하늘', orders: [{ menuIndex: 1, label: '짜장면', qty: 1, option: null }] }], issues: [] },
  ]);
  const out = await analyze({ chat: '하늘: 짜장면 하나요', menuText: '짬뽕 9000' }, client);
  assert.strictEqual(client.calls.length, 2);
  assert.match(client.calls[1].instructions, /1\. 짜장면 — 8000원/);
  assert.strictEqual(out.people[0].orders[0].menuIndex, 1);
  assert.strictEqual(client.calls[0].model, 'gpt-6-luna');
});

test('analyze: no menu skips menu step and forces -1', async () => {
  const client = fakeClient([{ unit: '개', people: [{ name: 'a', orders: [{ menuIndex: 2, label: '피자', qty: 1, option: null }] }], issues: [] }]);
  const out = await analyze({ chat: 'a: 피자' }, client);
  assert.strictEqual(client.calls.length, 1);
  assert.strictEqual(out.people[0].orders[0].menuIndex, -1);
});

test('analyze: model_not_found becomes a readable error', async () => {
  const client = { responses: { create: async () => Promise.reject(Object.assign(new Error('x'), { code: 'model_not_found', status: 404 })) } };
  await assert.rejects(analyze({ chat: 'a: b' }, client), /OPENAI_MODEL/);
});

test('core: totals and kakao text', () => {
  const result = C.hydrate({
    menu,
    unit: '개',
    people: [
      { name: '태윤', orders: [{ menuIndex: 0, label: '짬뽕', qty: 1 }] },
      { name: '민재', orders: [{ menuIndex: 0, label: '짬뽕', qty: 2 }, { menuIndex: -1, label: '콜라', qty: 1 }] },
    ],
  });
  const s = C.summarize(result);
  assert.strictEqual(s.totalQty, 4);
  assert.strictEqual(s.totalPrice, 27000);
  assert.strictEqual(s.unmatched.length, 1);
  const text = C.formatKakao(result);
  assert.match(text, /총 4개 · 27,000원/);
  assert.match(text, /짬뽕 3개 = 27,000원/);
  assert.match(text, /콜라 1개 ⚠메뉴판에 없음/);
  assert.match(text, /민재: 짬뽕 2, 콜라 → 18,000원 \+ 금액 미확인/);
});
