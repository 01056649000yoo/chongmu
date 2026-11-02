// ======= 총무해방 AI (영수증·메뉴판·주문 분석, 정산 챗) =======
(function () {
  const MAX_SIDE = 1600;
  const chatMessages = [];
  let chatBusy = false;

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) || `요청이 실패했어요 (${res.status}).`);
    return data;
  }

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = 'ai-status' + (kind ? ' ' + kind : '');
  }

  function imageToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('사진 파일을 골라 주세요.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('사진이 너무 커요(8MB까지).'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('사진을 읽지 못했어요.'));
      };
      img.src = url;
    });
  }

  function currentStateForAI() {
    const { balances, settlements } = compute();
    const total = state.expenses.reduce((sum, e) => sum + (Math.round(Number(e.amount)) || 0), 0);
    return {
      participants: state.participants.map((p) => ({
        name: p.name,
        paid: Math.round(balances[p.id] ? balances[p.id].paid : 0),
        owed: Math.round(balances[p.id] ? balances[p.id].owed : 0),
        net: Math.round(balances[p.id] ? balances[p.id].net : 0),
      })),
      expenses: state.expenses.map((e) => ({
        title: e.title,
        amount: e.amount,
        currency: e.currency || 'KRW',
        payer: nameOf(e.payerId),
        beneficiaries: e.beneficiaries.map((id) => nameOf(id)),
      })),
      settlements: settlements.map((s) => ({ from: nameOf(s.from), to: nameOf(s.to), amount: s.amount })),
      totals: { total: Math.round(total), count: state.expenses.length },
    };
  }

  function findParticipantId(name) {
    if (!name) return null;
    const target = String(name).replace(/\s+/g, '').toLowerCase();
    const hit = state.participants.find((p) => p.name.replace(/\s+/g, '').toLowerCase() === target);
    return hit ? hit.id : null;
  }

  function fillExpenseForm(items) {
    const list = items.filter((it) => it && Number(it.amount) > 0);
    if (!list.length) return 0;
    if (list.length === 1) {
      const it = list[0];
      document.getElementById('expTitle').value = it.title || '';
      document.getElementById('expAmount').value = Math.round(Number(it.amount));
      document.getElementById('expCurrency').value = it.currency || 'KRW';
      const payerId = findParticipantId(it.suggestedPayerName);
      if (payerId) document.getElementById('expPayer').value = payerId;
      const sharedIds = (it.suggestedSharedBy || []).map(findParticipantId).filter(Boolean);
      if (sharedIds.length) {
        document.querySelectorAll('#beneficiariesBox input[type="checkbox"]').forEach((cb) => (cb.checked = sharedIds.includes(cb.value)));
      }
      if (document.getElementById('splitCustom').checked) rebuildCustomShares();
      return 1;
    }
    // 여러 건: 지출을 새로 넣은 뒤 지출 목록에서 편집하도록 초안으로 붙여 둔다.
    const preview = document.getElementById('aiDrafts');
    preview.innerHTML = '';
    list.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'ai-draft';
      const payer = it.suggestedPayerName || '결제자';
      div.innerHTML =
        `<span class="ai-draft-name">${escapeHtml(it.title || '(이름 없음)')}</span>` +
        `<span class="ai-draft-meta">${escapeHtml(it.currency || 'KRW')} ${money(Number(it.amount))} · ${escapeHtml(payer)}</span>` +
        `<button type="button" class="btn small" data-ai-add="${list.indexOf(it)}">지출에 넣기</button>`;
      preview.appendChild(div);
    });
    preview.dataset.json = JSON.stringify(list);
    preview.dataset.pending = '1';
    return list.length;
  }

  function addOneExpense(it) {
    if (!state.participants.length) {
      alert('먼저 참가자를 추가하세요.');
      return false;
    }
    const currency = it.currency && /^[A-Z]{3}$/.test(it.currency) ? it.currency : 'KRW';
    const amount = Math.round(Number(it.amount));
    if (!(amount > 0)) {
      alert('금액이 0이에요. 금액을 직접 적어 주세요.');
      return false;
    }
    const payerId = findParticipantId(it.suggestedPayerName) || state.participants[0].id;
    const sharedIds = (it.suggestedSharedBy || []).map(findParticipantId).filter(Boolean);
    const beneficiaries = sharedIds.length ? sharedIds : state.participants.map((p) => p.id);
    state.expenses.push({
      id: uuid(),
      title: String(it.title || '지출').slice(0, 80),
      amount: currency === 'KRW' ? amount : Math.round(Number(it.krwAmount) || amount),
      payerId,
      beneficiaries,
      splitMode: 'equal',
      originalAmount: amount,
      currency,
      exchangeRate: currency === 'KRW' ? 1 : Number(it.exchangeRate) || 1,
    });
    return true;
  }

  function renderDraftsPending() {
    const preview = document.getElementById('aiDrafts');
    if (preview.dataset.pending !== '1') return;
    const list = JSON.parse(preview.dataset.json || '[]');
    preview.innerHTML = '';
    list.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'ai-draft';
      div.innerHTML =
        `<span class="ai-draft-name">${escapeHtml(it.title || '(이름 없음)')}</span>` +
        `<span class="ai-draft-meta">${escapeHtml(it.currency || 'KRW')} ${money(Number(it.amount))} · ${escapeHtml(it.suggestedPayerName || '결제자')}</span>` +
        `<button type="button" class="btn small" data-ai-add="${list.indexOf(it)}">지출에 넣기</button>`;
      preview.appendChild(div);
    });
  }

  document.getElementById('aiDrafts').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ai-add]');
    if (!btn) return;
    const preview = document.getElementById('aiDrafts');
    const list = JSON.parse(preview.dataset.json || '[]');
    const it = list[Number(btn.dataset.aiAdd)];
    if (it && addOneExpense(it)) {
      saveState();
      renderAll();
      btn.textContent = '넣었어요';
      btn.disabled = true;
    }
  });

  // ---- 파일 고르기 → 분석 ----
  let pendingKind = 'receipt';
  const fileInput = document.getElementById('aiPhoto');
  document.querySelectorAll('[data-ai-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingKind = btn.dataset.aiPick;
      fileInput.click();
    });
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const status = document.getElementById('aiPhotoStatus');
    const preview = document.getElementById('aiDrafts');
    preview.dataset.pending = '';
    preview.innerHTML = '';
    setStatus(status, '사진을 읽고 있어요…', 'busy');
    document.querySelectorAll('[data-ai-pick]').forEach((b) => (b.disabled = true));
    try {
      const dataUrl = await imageToDataUrl(file);
      const result = await api(pendingKind === 'menu' ? '/api/menu-image' : '/api/receipt', { image: dataUrl });
      if (pendingKind === 'receipt') {
        if (result.isExpense && result.expense) {
          const n = fillExpenseForm([result.expense]);
          setStatus(status, `금액 ${money(Number(result.expense.amount))} ${result.expense.currency} 을(를) 폼에 채웠어요. 확인하고 '지출 추가'를 누르세요.` + (result.note ? ' ' + result.note : ''), 'ok');
        } else {
          setStatus(status, result.note || '지출로 볼 수 있는 영수증이 아니에요.', 'warn');
        }
      } else {
        const n = fillExpenseForm(result.expenses || []);
        setStatus(
          status,
          n ? `${n}개 항목을 찾았어요. 목록에서 '지출에 넣기'를 누르세요.` + (result.notes ? ' ' + result.notes : '') : '항목을 찾지 못했어요. 더 가까이 찍어 주세요.',
          n ? 'ok' : 'warn'
        );
      }
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      document.querySelectorAll('[data-ai-pick]').forEach((b) => (b.disabled = false));
    }
  });

  // ---- 주문/영수증 글 분석 ----
  document.getElementById('aiTextRun').addEventListener('click', async () => {
    const textEl = document.getElementById('aiText');
    const status = document.getElementById('aiTextStatus');
    const btn = document.getElementById('aiTextRun');
    const text = textEl.value.trim();
    if (!text) return setStatus(status, '분석할 글을 붙여 넣어 주세요.', 'warn');
    btn.disabled = true;
    setStatus(status, '분석하고 있어요…', 'busy');
    document.getElementById('aiDrafts').dataset.pending = '';
    document.getElementById('aiDrafts').innerHTML = '';
    try {
      const result = await api('/api/orders-text', {
        text,
        participants: state.participants.map((p) => p.name),
      });
      const n = fillExpenseForm(result.expenses || []);
      setStatus(
        status,
        n ? `${n}건의 지출을 찾았어요.` + (n === 1 ? ' 폼에 채웠어요. 확인하고 추가하세요.' : " 아래 목록에서 '지출에 넣기'를 누르세요.") + (result.notes ? ' ' + result.notes : '') : '지출로 볼 수 있는 내용이 없어요.',
        n ? 'ok' : 'warn'
      );
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // ---- 정산 AI 설명 ----
  document.getElementById('aiSummaryRun').addEventListener('click', async () => {
    const out = document.getElementById('aiSummaryOut');
    const btn = document.getElementById('aiSummaryRun');
    btn.disabled = true;
    out.innerHTML = '<div class="muted">정산을 읽고 있어요…</div>';
    try {
      const r = await api('/api/summarize', { state: currentStateForAI() });
      out.innerHTML = '';
      const p = document.createElement('div');
      p.className = 'ai-summary-text';
      p.textContent = r.summary;
      out.appendChild(p);
      if (r.tips && r.tips.length) {
        const ul = document.createElement('ul');
        ul.className = 'ai-tips';
        r.tips.forEach((t) => {
          const li = document.createElement('li');
          li.textContent = t;
          ul.appendChild(li);
        });
        out.appendChild(ul);
      }
    } catch (err) {
      out.innerHTML = '';
      const p = document.createElement('div');
      p.className = 'ai-status err';
      p.textContent = err.message;
      out.appendChild(p);
    } finally {
      btn.disabled = false;
    }
  });

  // ---- 챗 ----
  function appendChat(role, text) {
    const list = document.getElementById('aiChatLog');
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    div.textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  async function sendChat() {
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    input.value = '';
    document.getElementById('aiChatSend').disabled = true;
    chatMessages.push({ role: 'user', content: text });
    appendChat('user', text);
    const thinking = appendChat('assistant', '…');
    thinking.classList.add('busy');
    try {
      const r = await api('/api/chat', { messages: chatMessages, state: currentStateForAI() });
      thinking.classList.remove('busy');
      thinking.textContent = r.reply;
      chatMessages.push({ role: 'assistant', content: r.reply });
    } catch (err) {
      thinking.classList.remove('busy');
      thinking.textContent = err.message;
      thinking.classList.add('err');
      chatMessages.push({ role: 'assistant', content: err.message });
    } finally {
      chatBusy = false;
      document.getElementById('aiChatSend').disabled = false;
      input.focus();
    }
  }
  document.getElementById('aiChatSend').addEventListener('click', sendChat);
  document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  fetch('/api/health')
    .then((r) => r.json())
    .then((h) => {
      const el = document.getElementById('aiHealth');
      if (!h.keyConfigured) setStatus(el, '서버에 OpenAI 키가 없어요. .env 에 OPENAI_API_KEY 를 넣고 서버를 다시 시작하세요.', 'warn');
      else setStatus(el, `AI 준비됨 · ${h.model}`, 'ok');
    })
    .catch(() => setStatus(document.getElementById('aiHealth'), 'AI 서버에 연결하지 못했어요. (python 정적 서버로 열면 AI 기능이 꺼져요)', 'warn'));

  const origRenderAll = renderAll;
  renderAll = function () {
    origRenderAll();
    renderDraftsPending();
  };
})();
