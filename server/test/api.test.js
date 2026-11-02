const test = require('node:test');
const assert = require('node:assert');
const { assertImage, sanitizeState, sanitizeHistory, sanitizeNames } = require('../lib/validate');
const { createLimiter } = require('../server');

test('settlement image: accepts data url, rejects others', () => {
  assert.strictEqual(assertImage('data:image/png;base64,AAAA').ok, true);
  assert.strictEqual(assertImage('http://x/y.png').ok, false);
  assert.strictEqual(assertImage('data:text/html;base64,AAAA').ok, false);
  assert.strictEqual(assertImage(undefined).ok, false);
});

test('settlement image: rejects bigger than 8MB', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(11 * 1024 * 1024);
  assert.strictEqual(assertImage(big).ok, false);
});

test('sanitizeState keeps shape and clamps numbers', () => {
  const s = sanitizeState({
    participants: [{ name: '지민', paid: '30000', owed: 10, net: -5 }],
    expenses: [{ title: '택시', amount: '18000', currency: 'KRW', payer: '지민', beneficiaries: ['지민', '은서'] }],
    settlements: [{ from: '지민', to: '은서', amount: '18000' }],
    totals: { total: '48000', count: '2' },
    junk: 'x',
  });
  assert.strictEqual(s.participants[0].paid, 30000);
  assert.strictEqual(s.expenses[0].amount, 18000);
  assert.deepStrictEqual(s.expenses[0].beneficiaries, ['지민', '은서']);
  assert.strictEqual(s.totals.total, 48000);
  assert.strictEqual(s.junk, undefined);
});

test('sanitizeState tolerates garbage', () => {
  const s = sanitizeState(null);
  assert.deepStrictEqual(s.participants, []);
  assert.deepStrictEqual(s.expenses, []);
  assert.deepStrictEqual(sanitizeNames([1, ' 지민 ', null, '가'.repeat(100)]), ['지민', '가'.repeat(40)]);
});

test('sanitizeHistory keeps last 20 valid turns', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  msgs.push({ role: 'system', content: 'x' }, { role: 'user', content: 123 });
  const h = sanitizeHistory(msgs);
  assert.strictEqual(h.length, 20);
  assert.ok(h.every((m) => typeof m.content === 'string'));
  assert.strictEqual(sanitizeHistory('nope').length, 0);
});

test('rate limiter blocks after max in window', () => {
  const allow = createLimiter({ windowMs: 1000, max: 2 });
  assert.strictEqual(allow('a'), true);
  assert.strictEqual(allow('a'), true);
  assert.strictEqual(allow('a'), false);
  assert.strictEqual(allow('b'), true);
});
