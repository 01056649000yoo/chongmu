// ======= State =======
const LS_KEY = 'trip-splitter-state-v1';
const state = loadState() || {
  participants: [], // {id, name}
  expenses: [], // {id, title, amount, payerId, beneficiaries: [id], splitMode: 'equal'|'custom', shares?: {id:amount}}
};
let editingExpenseId = null;

// ======= Utils =======
const uuid = () =>
  window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
const money = (n) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)));
const byId = (id, participants = state.participants) => participants.find((p) => p.id === id);
const nameOf = (id, participants = state.participants) => (byId(id, participants) || {}).name || '—';
const clamp0 = (n) => Math.max(0, Math.round(Number(n || 0)));

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '');
  } catch (e) {
    return null;
  }
}
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return (str || '').replace(/[&<>"']/g, (s) => map[s]);
}

// ======= Compute =======
function compute(participants = state.participants, expenses = state.expenses) {
  const balances = {}; // id -> {paid, owed, net}
  participants.forEach((p) => (balances[p.id] = { paid: 0, owed: 0, net: 0 }));

  // 1원 단위: 결제액은 그대로 더하고, 부담액은 내림 몫 + 남은 원(앞쪽부터 1원)으로 나눠
  // 어떤 경우에도 결제 합계와 부담 합계가 정확히 같아지게 한다 (개별 금액 분배는 적힌 값 그대로).
  expenses.forEach((exp) => {
    const amount = Math.round(Number(exp.amount) || 0);
    if (!amount) return;
    if (balances[exp.payerId]) balances[exp.payerId].paid += amount;
    const ben = Array.isArray(exp.beneficiaries) ? exp.beneficiaries : [];
    if (!ben.length) return;
    if (exp.splitMode === 'custom' && exp.shares && typeof exp.shares === 'object') {
      let written = 0;
      ben.forEach((id) => {
        const v = clamp0(exp.shares[id]);
        written += v;
        if (balances[id]) balances[id].owed += v;
      });
      const gap = amount - written;
      if (gap !== 0 && balances[ben[0]]) balances[ben[0]].owed += gap;
    } else {
      const base = Math.floor(amount / ben.length);
      const extra = amount - base * ben.length;
      ben.forEach((id, k) => {
        if (balances[id]) balances[id].owed += base + (k < extra ? 1 : 0);
      });
    }
  });

  participants.forEach((p) => {
    const b = balances[p.id];
    b.owed = Math.round(b.owed);
    b.paid = Math.round(b.paid);
    b.net = b.paid - b.owed;
  });

  let owedSum = 0;
  for (const id in balances) owedSum += balances[id].owed;
  let paidSum = 0;
  for (const id in balances) paidSum += balances[id].paid;
  const leftover = paidSum - owedSum;
  if (leftover !== 0) {
    // 잘못 저장된(합이 총액과 안 맞는) 개별 금액 등을 남은 차액만큼 결제자에게 붙여 총합을 맞춘다
    const fixTarget = participants.filter((p) => balances[p.id].paid > 0);
    const target = fixTarget[0] || participants[0];
    if (target) {
      balances[target.id].owed += leftover;
      balances[target.id].net = balances[target.id].paid - balances[target.id].owed;
    }
  }

  const creditors = [];
  const debtors = [];
  for (const id in balances) {
    const net = balances[id].net;
    if (net > 0) creditors.push({ id, amount: net });
    else if (net < 0) debtors.push({ id, amount: -net });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const pay = Math.min(d.amount, c.amount);
    if (pay > 0) settlements.push({ from: d.id, to: c.id, amount: Math.round(pay) });
    d.amount -= pay;
    c.amount -= pay;
    if (Math.round(d.amount) === 0) i++;
    if (Math.round(c.amount) === 0) j++;
  }
  return { balances, settlements };
}

// ======= Rendering =======
function renderParticipants() {
  const box = document.getElementById('participantsList');
  box.innerHTML = '';
  state.participants.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'chip participant-chip';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    const renameBtn = document.createElement('button');
    renameBtn.className = 'icon-btn';
    renameBtn.dataset.action = 'rename';
    renameBtn.dataset.id = p.id;
    renameBtn.title = '이름 바꾸기';
    renameBtn.setAttribute('aria-label', `${p.name} 이름 바꾸기`);
    renameBtn.innerHTML = TripUI.icon('pencil');
    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn danger';
    removeBtn.dataset.action = 'remove';
    removeBtn.dataset.id = p.id;
    removeBtn.title = '삭제';
    removeBtn.setAttribute('aria-label', `${p.name} 삭제`);
    removeBtn.innerHTML = TripUI.icon('x');
    chip.appendChild(nameSpan);
    chip.appendChild(renameBtn);
    chip.appendChild(removeBtn);
    box.appendChild(chip);
  });

  const payerSel = document.getElementById('expPayer');
  payerSel.innerHTML = state.participants.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  const benBox = document.getElementById('beneficiariesBox');
  benBox.innerHTML = state.participants
    .map((p) => {
      const id = `ben-${p.id}`;
      return `<label class="chip" for="${id}"><input type="checkbox" id="${id}" value="${p.id}" checked><span>${escapeHtml(p.name)}</span></label>`;
    })
    .join('');

  const disabled = state.participants.length === 0;
  document.getElementById('expTitle').disabled = disabled;
  document.getElementById('expAmount').disabled = disabled;
  document.getElementById('expPayer').disabled = disabled;
  document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.disabled = disabled));
  document.getElementById('addExpenseBtn').disabled = disabled;
  const customRadio = document.getElementById('splitCustom');
  const customBox = document.getElementById('customShares');
  if (customRadio && customRadio.checked) {
    if (customBox) customBox.style.display = 'block';
    rebuildCustomShares();
  } else if (customBox) {
    customBox.style.display = 'none';
    customBox.innerHTML = '';
  }
}

function renderExpenses() {
  const table = document.getElementById('expensesTable');
  const hint = document.getElementById('expensesHint');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  if (state.expenses.length === 0) {
    table.style.display = 'none';
    hint.style.display = 'block';
  } else {
    table.style.display = '';
    hint.style.display = 'none';
  }

  state.expenses.forEach((exp) => {
    const tr = document.createElement('tr');
    const perHead = exp.splitMode === 'custom' ? null : exp.beneficiaries.length ? Math.round(exp.amount / exp.beneficiaries.length) : 0;

    // Currency display helper
    const currencySymbols = { KRW: '₩', USD: '$', JPY: '¥', EUR: '€', CNY: '¥', GBP: '£' };
    const symbol = currencySymbols[exp.currency] || '₩';
    const amountDisplay = exp.currency && exp.currency !== 'KRW'
      ? `${symbol} ${money(exp.originalAmount)} <span class="muted small">(₩${money(exp.amount)})</span>`
      : `₩ ${money(exp.amount)}`;

    tr.innerHTML = `
      <td>${escapeHtml(exp.title || '')}</td>
      <td class="right">${amountDisplay}</td>
      <td>${escapeHtml(nameOf(exp.payerId))}</td>
      <td>${exp.beneficiaries.map((id) => `<span class="tag">${escapeHtml(nameOf(id))}</span>`).join(' ')}</td>
      <td class="right">${exp.beneficiaries.length ? (exp.splitMode === 'custom' ? '개별' : `₩ ${money(perHead)}`) : '—'}</td>
      <td>
        <div class="row" style="gap:6px">
          <button class="btn small icon-only" data-action="edit-exp" data-id="${exp.id}" title="지출 편집" aria-label="${escapeHtml(exp.title)} 편집">${TripUI.icon('pencil')}</button>
          <button class="btn small icon-only danger" data-action="del-exp" data-id="${exp.id}" title="지출 삭제" aria-label="${escapeHtml(exp.title)} 삭제">${TripUI.icon('x')}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderBalancesAndSettlements() {
  const { balances, settlements } = compute();

  const balDiv = document.getElementById('balances');
  balDiv.innerHTML = '';
  if (state.participants.length === 0) {
    balDiv.innerHTML = '<div class="muted">참가자를 추가하세요.</div>';
  } else {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr><th>이름</th><th class="right">지불합계</th><th class="right">사용합계</th><th class="right">순액</th></tr></thead>
      <tbody></tbody>`;
    const tb = table.querySelector('tbody');
    state.participants.forEach((p) => {
      const b = balances[p.id] || { paid: 0, owed: 0, net: 0 };
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td class="right">₩ ${money(b.paid)}</td>
        <td class="right">₩ ${money(b.owed)}</td>
        <td class="right">${b.net >= 0 ? `<span class="pill pos">+₩ ${money(b.net)}</span>` : `<span class="pill neg">-₩ ${money(-b.net)}</span>`}</td>
      `;
      tb.appendChild(tr);
    });
    balDiv.appendChild(table);
  }

  const setDiv = document.getElementById('settlements');
  setDiv.innerHTML = '';
  if (!settlements.length) {
    setDiv.innerHTML = '<div class="muted">정산할 내역이 없습니다.</div>';
  } else {
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    settlements.forEach((s) => {
      const li = document.createElement('li');
      li.style.padding = '6px 0';
      li.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a1 1 0 11-2 0 1 1 0 012 0z" /></svg> <strong>${escapeHtml(nameOf(s.from))}</strong> → <strong>${escapeHtml(nameOf(s.to))}</strong> : <strong>₩ ${money(s.amount)}</strong>`;
      ul.appendChild(li);
    });
    setDiv.appendChild(ul);
  }
}

// ===== Helper: participant ops =====
function renameParticipant(id) {
  const p = state.participants.find((pp) => pp.id === id);
  if (!p) return;
  const nn = prompt('새 이름을 입력하세요', p.name);
  if (!nn) return;
  p.name = nn.trim();
  saveState();
  renderAll();
}
function removeParticipant(id) {
  if (!confirm('해당 참가자를 삭제할까요? 관련 지출의 참여자/개별금액에서도 제거됩니다.')) return;
  state.participants = state.participants.filter((p) => p.id !== id);
  state.expenses.forEach((exp) => {
    if (exp.payerId === id) exp.payerId = state.participants[0]?.id || null;
    exp.beneficiaries = exp.beneficiaries.filter((bid) => bid !== id);
    if (exp.shares && exp.shares[id] != null) delete exp.shares[id];
  });
  saveState();
  renderAll();
}

// ===== Helper: split UI =====
function getSelectedBeneficiaries() {
  return Array.from(document.querySelectorAll('#beneficiariesBox input:checked')).map((cb) => cb.value);
}
function rebuildCustomShares(prefill) {
  const box = document.getElementById('customShares');
  const ids = getSelectedBeneficiaries();
  box.innerHTML = '';
  if (!ids.length) {
    box.innerHTML = '<div class="muted small">참여자를 선택하면 개별 금액을 입력할 수 있어요.</div>';
    return;
  }
  ids.forEach((id) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div style="flex:1">${escapeHtml(nameOf(id))}</div><div style="flex:0 0 160px"><input type="number" min="0" step="1" id="share-${id}" placeholder="금액(원)"></div>`;
    box.appendChild(row);
    if (prefill && prefill[id] != null) {
      const el = document.getElementById('share-' + id);
      if (el) el.value = clamp0(prefill[id]);
    }
  });
  const note = document.createElement('div');
  note.className = 'sum-note';
  note.id = 'customSumNote';
  box.appendChild(note);
  updateCustomSumNote();
  ids.forEach((id) => {
    const el = document.getElementById('share-' + id);
    if (el) el.addEventListener('input', updateCustomSumNote);
  });
}
function updateCustomSumNote() {
  const note = document.getElementById('customSumNote');
  if (!note) return;
  const amount = Math.round(Number(document.getElementById('expAmount').value || 0));
  const ids = getSelectedBeneficiaries();
  let sum = 0;
  ids.forEach((id) => {
    const v = Math.round(Number((document.getElementById('share-' + id)?.value) || 0));
    sum += v;
  });
  note.textContent = `개별 합계: ₩ ${money(sum)} / 총액: ₩ ${money(amount)}`;
}

// ======= Events =======
document.getElementById('addParticipantBtn').addEventListener('click', () => {
  const nameEl = document.getElementById('participantName');
  const name = nameEl.value.trim();
  if (!name) return;
  state.participants.push({ id: uuid(), name });
  nameEl.value = '';
  saveState();
  renderAll();
});

document.getElementById('participantsList').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  if (action === 'remove') removeParticipant(id);
  else if (action === 'rename') renameParticipant(id);
});

document.getElementById('selectAllBeneficiaries').addEventListener('click', () => {
  document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  if (document.getElementById('splitCustom').checked) rebuildCustomShares();
});
document.getElementById('clearAllBeneficiaries').addEventListener('click', () => {
  document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  if (document.getElementById('splitCustom').checked) rebuildCustomShares();
});
document.getElementById('beneficiariesBox').addEventListener('change', () => {
  if (document.getElementById('splitCustom').checked) rebuildCustomShares();
});
document.getElementById('splitEqual').addEventListener('change', () => {
  document.getElementById('customShares').style.display = 'none';
});
document.getElementById('splitCustom').addEventListener('change', () => {
  const box = document.getElementById('customShares');
  if (box) box.style.display = 'block';
  rebuildCustomShares();
});
document.getElementById('expAmount').addEventListener('input', updateCustomSumNote);

document.getElementById('addExpenseBtn').addEventListener('click', () => {
  const title = document.getElementById('expTitle').value.trim();
  const rawAmount = Math.round(Number(document.getElementById('expAmount').value || 0));
  const currency = document.getElementById('expCurrency').value;
  const exchangeRate = currency === 'KRW' ? 1 : Number(document.getElementById('expExchangeRate').value || 1);
  const amount = Math.round(rawAmount * exchangeRate); // 원화로 변환
  const payerId = document.getElementById('expPayer').value;
  const beneficiaries = Array.from(document.querySelectorAll('#beneficiariesBox input:checked')).map((cb) => cb.value);

  if (!state.participants.length) {
    alert('먼저 참가자를 추가하세요.');
    return;
  }
  if (!title) {
    alert('항목명을 입력하세요.');
    return;
  }
  if (!(amount > 0)) {
    alert('금액을 1원 이상 입력하세요.');
    return;
  }
  if (!payerId) {
    alert('결제자를 선택하세요.');
    return;
  }
  if (!beneficiaries.length) {
    alert('적어도 1명의 참여자를 선택하세요.');
    return;
  }

  if (editingExpenseId) {
    const ex = state.expenses.find((e) => e.id === editingExpenseId);
    if (ex) {
      ex.title = title;
      ex.amount = amount;
      ex.originalAmount = rawAmount;
      ex.currency = currency;
      ex.exchangeRate = exchangeRate;
      ex.payerId = payerId;
      ex.beneficiaries = beneficiaries;
      const splitMode = document.getElementById('splitCustom').checked ? 'custom' : 'equal';
      ex.splitMode = splitMode;
      if (splitMode === 'custom') {
        const shares = {};
        let sum = 0;
        beneficiaries.forEach((id) => {
          const v = Math.round(Number((document.getElementById('share-' + id)?.value) || 0));
          shares[id] = v;
          sum += v;
        });
        if (sum !== amount) {
          alert(`개별 금액의 합(₩ ${money(sum)})이 총액(₩ ${money(amount)})과 일치해야 합니다.`);
          return;
        }
        ex.shares = shares;
      } else {
        delete ex.shares;
      }
    }
    editingExpenseId = null;
    document.getElementById('addExpenseBtn').textContent = '지출 추가';
    document.getElementById('cancelEditBtn').style.display = 'none';
  } else {
    const splitMode = document.getElementById('splitCustom').checked ? 'custom' : 'equal';
    const expense = { id: uuid(), title, amount, payerId, beneficiaries, splitMode, originalAmount: rawAmount, currency, exchangeRate };
    if (splitMode === 'custom') {
      const shares = {};
      let sum = 0;
      beneficiaries.forEach((id) => {
        const v = Math.round(Number((document.getElementById('share-' + id)?.value) || 0));
        shares[id] = v;
        sum += v;
      });
      if (sum !== amount) {
        alert(`개별 금액의 합(₩ ${money(sum)})이 총액(₩ ${money(amount)})과 일치해야 합니다.`);
        return;
      }
      expense.shares = shares;
    }
    state.expenses.push(expense);
  }

  document.getElementById('expTitle').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expCurrency').value = 'KRW';
  document.getElementById('exchangeRateRow').style.display = 'none';
  document.getElementById('expExchangeRate').value = '';
  saveState();
  renderAll();
});

document.getElementById('cancelEditBtn').addEventListener('click', () => {
  editingExpenseId = null;
  document.getElementById('addExpenseBtn').textContent = '지출 추가';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('expTitle').value = '';
  document.getElementById('expAmount').value = '';
  document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  document.getElementById('splitEqual').checked = true;
  document.getElementById('splitCustom').checked = false;
  document.getElementById('customShares').style.display = 'none';
  document.getElementById('customShares').innerHTML = '';
});

document.getElementById('expensesTable').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  if (action === 'del-exp') {
    if (!confirm('이 지출 항목을 삭제할까요?')) return;
    state.expenses = state.expenses.filter((x) => x.id !== id);
    saveState();
    renderAll();
  } else if (action === 'edit-exp') {
    const ex = state.expenses.find((x) => x.id === id);
    if (!ex) return;
    editingExpenseId = id;
    document.getElementById('expTitle').value = ex.title;
    document.getElementById('expAmount').value = ex.amount;
    document.getElementById('expPayer').value = ex.payerId;
    document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.checked = ex.beneficiaries.includes(cb.value)));
    if (ex.splitMode === 'custom') {
      document.getElementById('splitCustom').checked = true;
      document.getElementById('splitEqual').checked = false;
      const box = document.getElementById('customShares');
      if (box) box.style.display = 'block';
      rebuildCustomShares(ex.shares || {});
    } else {
      document.getElementById('splitEqual').checked = true;
      document.getElementById('splitCustom').checked = false;
      document.getElementById('customShares').style.display = 'none';
      document.getElementById('customShares').innerHTML = '';
    }
    document.getElementById('addExpenseBtn').textContent = '변경 저장';
    document.getElementById('cancelEditBtn').style.display = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('모든 데이터를 초기화할까요? 되돌릴 수 없습니다.')) return;
  state.participants = [];
  state.expenses = [];
  localStorage.removeItem(LS_KEY);
  renderAll();
});

function renderAll() {
  renderParticipants();
  renderExpenses();
  renderBalancesAndSettlements();
}

// Initial render
renderAll();
