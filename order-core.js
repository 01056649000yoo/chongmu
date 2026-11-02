// 주문 정리 계산·양식 (브라우저와 Node 테스트가 함께 씀). AI는 "누가 뭘 몇 개"만 읽고,
// 금액 계산과 카톡 양식은 전부 여기서 코드로 처리해 숫자가 어긋나지 않게 한다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OrderCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;

  function orderLine(menu, person, order) {
    const item = Number.isInteger(order.menuIndex) && order.menuIndex >= 0 ? menu[order.menuIndex] || null : null;
    const unit = item && Number.isFinite(item.price) ? item.price : null;
    return {
      person,
      order,
      item,
      name: item ? item.name : order.label,
      unitPrice: unit,
      total: unit == null ? null : unit * order.qty,
    };
  }

  function flatten(result) {
    const lines = [];
    for (const p of result.people) for (const o of p.orders) lines.push(orderLine(result.menu, p.name, o));
    return lines;
  }

  // 메뉴별 합계: 같은 메뉴(+같은 옵션)는 한 줄로, 메뉴판에 못 맞춘 주문은 따로 모은다.
  function summarize(result) {
    const groups = new Map();
    for (const l of flatten(result)) {
      const key = l.item ? `m${result.menu.indexOf(l.item)}|${l.order.option || ''}` : `u|${l.order.label}|${l.order.option || ''}`;
      let g = groups.get(key);
      if (!g) {
        g = { name: l.name, option: l.order.option || '', unitPrice: l.unitPrice, qty: 0, total: l.unitPrice == null ? null : 0, matched: Boolean(l.item), people: [] };
        groups.set(key, g);
      }
      g.qty += l.order.qty;
      if (g.total != null) g.total += l.total;
      g.people.push(l.person);
    }
    const rows = [...groups.values()];
    const matched = rows.filter((g) => g.matched);
    const unmatched = rows.filter((g) => !g.matched);
    return {
      rows,
      matched,
      unmatched,
      totalQty: rows.reduce((s, g) => s + g.qty, 0),
      totalPrice: matched.reduce((s, g) => s + (g.total || 0), 0),
      hasMenu: result.menu.length > 0,
      missingPrice: rows.length > 0 && rows.some((g) => g.total == null),
    };
  }

  function personTotals(result) {
    return result.people.map((p) => {
      const lines = p.orders.map((o) => orderLine(result.menu, p.name, o));
      const known = lines.filter((l) => l.total != null);
      return {
        name: p.name,
        lines,
        qty: p.orders.reduce((s, o) => s + o.qty, 0),
        total: known.reduce((s, l) => s + l.total, 0),
        incomplete: known.length !== lines.length,
      };
    });
  }

  const labelOf = (name, option) => (option ? `${name}(${option})` : name);

  // 카카오톡 방에 그대로 붙여 넣을 글.
  function formatKakao(result, opts = {}) {
    const o = { prices: true, people: true, unit: result.unit || '개', title: '주문 정리', ...opts };
    const s = summarize(result);
    const showPrice = o.prices && s.hasMenu;
    const out = [];
    const head = `📋 ${o.title} (총 ${s.totalQty}${o.unit}${showPrice ? ` · ${won(s.totalPrice)}` : ''})`;
    out.push(head, '');

    out.push('■ 메뉴별');
    for (const g of s.rows) {
      const price = showPrice && g.total != null ? ` = ${won(g.total)}` : '';
      const unitTxt = showPrice && g.unitPrice != null && g.qty > 1 ? ` (${won(g.unitPrice)}×${g.qty})` : '';
      out.push(`- ${labelOf(g.name, g.option)} ${g.qty}${o.unit}${price}${unitTxt}${g.matched || !s.hasMenu ? '' : ' ⚠메뉴판에 없음'}`);
    }

    if (o.people) {
      out.push('', '■ 사람별');
      for (const p of personTotals(result)) {
        const items = p.lines.map((l) => `${labelOf(l.name, l.order.option)}${l.order.qty > 1 ? ` ${l.order.qty}` : ''}`).join(', ');
        const price = showPrice ? (p.total === 0 && p.incomplete ? ' → 금액 확인 필요' : ` → ${won(p.total)}${p.incomplete ? ' + 금액 미확인' : ''}`) : '';
        out.push(`- ${p.name}: ${items}${price}`);
      }
    }

    if (showPrice) out.push('', `💰 합계 ${won(s.totalPrice)}`);
    return out.join('\n');
  }

  // 서버가 돌려준 값을 화면용으로 다듬는다(수정할 때 쓸 id 부여).
  function hydrate(data) {
    let seq = 0;
    return {
      menu: (data.menu || []).map((m) => ({ name: m.name, price: Number.isFinite(m.price) ? m.price : null })),
      unit: data.unit || '개',
      issues: data.issues || [],
      people: (data.people || []).map((p) => ({
        name: p.name,
        orders: p.orders.map((o) => ({ id: `o${++seq}`, menuIndex: o.menuIndex, label: o.label, qty: o.qty, option: o.option || '' })),
      })),
    };
  }

  return { won, flatten, summarize, personTotals, formatKakao, hydrate };
});
