(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.OrderCore;
  let state = null; // 분석 결과(검토·수정 대상)
  let menuImage = null;
  let menuRows = []; // 설정 단계의 메뉴(이름·가격)

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) n.append(k);
    return n;
  };
  const showError = (msg) => {
    $('error').textContent = msg || '';
    $('error').hidden = !msg;
  };
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `오류가 났어요 (${res.status})`);
    return data;
  };
  const busy = (btn, label, on) => {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.replaceChildren(el('span', { className: 'spin' }), label);
    } else btn.textContent = btn.dataset.label;
    btn.disabled = on;
  };

  fetch('/api/health')
    .then((r) => r.json())
    .then((h) => {
      $('status').textContent = h.keyConfigured ? `AI 연결됨 · ${h.model}` : 'OpenAI 키 없음 (.env 확인)';
      $('status').className = `status ${h.keyConfigured ? 'ok' : 'bad'}`;
    })
    .catch(() => {
      $('status').textContent = '서버에 연결할 수 없어요';
      $('status').className = 'status bad';
    });

  function setStep() {
    const reached = state ? 4 : menuRows.length ? 2 : 1;
    document.querySelectorAll('#steps li').forEach((li) => {
      const n = Number(li.dataset.s);
      li.classList.toggle('on', n === reached);
      li.classList.toggle('done', n < reached);
    });
  }

  // ---- 1·2단계 입력 ----
  $('chat').addEventListener('input', () => ($('chat-count').textContent = `${$('chat').value.length.toLocaleString()}자`));

  document.querySelectorAll('.seg button').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach((x) => {
        x.classList.toggle('on', x === t);
        x.setAttribute('aria-selected', String(x === t));
      });
      const image = t.dataset.tab === 'image';
      $('menu-text').hidden = image;
      $('menu-image-box').hidden = !image;
    })
  );

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('사진을 열 수 없어요.'));
      img.src = url;
    });
  }

  $('menu-image').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    menuImage = null;
    $('menu-preview').hidden = true;
    if (!f) return;
    try {
      menuImage = await shrink(f);
      $('menu-preview').src = menuImage;
      $('menu-preview').hidden = false;
    } catch (err) {
      showError(err.message);
    }
  });

  function renderMenu() {
    $('menu-empty').hidden = menuRows.length > 0;
    $('menu-rows').replaceChildren(
      ...menuRows.map((m, i) => {
        const name = el('input', { value: m.name, placeholder: '메뉴 이름', ariaLabel: '메뉴 이름' });
        const price = el('input', { type: 'number', min: 0, step: 100, value: m.price ?? '', placeholder: '가격(원)', ariaLabel: '가격' });
        const del = el('button', { type: 'button', textContent: '✕', ariaLabel: '메뉴 삭제' });
        name.addEventListener('input', () => (m.name = name.value));
        price.addEventListener('input', () => (m.price = price.value === '' ? null : Number(price.value)));
        del.addEventListener('click', () => {
          menuRows.splice(i, 1);
          renderMenu();
        });
        return el('div', { className: 'mrow' }, name, price, del);
      })
    );
    setStep();
  }

  $('add-menu').addEventListener('click', () => {
    menuRows.push({ name: '', price: null });
    renderMenu();
    const inputs = $('menu-rows').querySelectorAll('input');
    inputs[inputs.length - 2].focus();
  });

  async function readMenu() {
    const useImage = document.querySelector('.seg button.on').dataset.tab === 'image';
    const body = useImage ? { image: menuImage } : { text: $('menu-text').value.trim() };
    if (!body.image && !body.text) throw new Error(useImage ? '메뉴판 사진을 골라 주세요.' : '가격표 글을 붙여 넣어 주세요.');
    const data = await post('/api/order/menu', body);
    menuRows = data.menu.map((m) => ({ ...m }));
    renderMenu();
    return data;
  }

  $('read-menu').addEventListener('click', async () => {
    showError('');
    busy($('read-menu'), '메뉴 읽는 중…', true);
    try {
      const d = await readMenu();
      if (!d.menu.length) showError('메뉴를 찾지 못했어요. 글이나 사진을 확인해 주세요.');
    } catch (err) {
      showError(err.message);
    } finally {
      busy($('read-menu'), '', false);
    }
  });

  $('sample').addEventListener('click', async () => {
    const [chat, menu] = await Promise.all(['testdata/chat-noodle.txt', 'testdata/menu-noodle.txt'].map((u) => fetch(u).then((r) => r.text())));
    $('chat').value = chat;
    $('menu-text').value = menu;
    $('chat').dispatchEvent(new Event('input'));
    $('s1').scrollIntoView({ behavior: 'smooth' });
  });

  $('reset').addEventListener('click', () => {
    $('chat').value = '';
    $('chat').dispatchEvent(new Event('input'));
    state = null;
    $('s3').hidden = $('s4').hidden = true;
    showError('');
    setStep();
  });

  // ---- 분석 ----
  $('analyze').addEventListener('click', async () => {
    showError('');
    const chat = $('chat').value.trim();
    if (!chat) return showError('1단계에 카톡 대화를 붙여 넣어 주세요.');
    busy($('analyze'), '대화를 읽는 중… (10~30초)', true);
    try {
      // 메뉴 칸이 비었는데 글/사진이 있으면 먼저 읽어 둔다.
      const hasSource = document.querySelector('.seg button.on').dataset.tab === 'image' ? Boolean(menuImage) : Boolean($('menu-text').value.trim());
      if (!menuRows.length && hasSource) await readMenu();
      const menu = menuRows.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), price: m.price }));
      const data = await post('/api/order/analyze', { chat, menu });
      state = C.hydrate(data);
      $('opt-unit').value = state.unit;
      if (!state.people.length) {
        state = null;
        $('s3').hidden = $('s4').hidden = true;
        throw new Error('주문을 찾지 못했어요. 대화 내용을 확인해 주세요.');
      }
      $('s3').hidden = $('s4').hidden = false;
      render();
      $('s3').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showError(err.message);
    } finally {
      busy($('analyze'), '', false);
    }
  });

  // ---- 3·4단계 ----
  const kakaoText = () =>
    C.formatKakao(state, {
      prices: $('opt-prices').checked,
      people: $('opt-people').checked,
      title: $('opt-title').value.trim() || '주문 정리',
      unit: $('opt-unit').value.trim() || '개',
    });

  function render() {
    setStep();
    const s = C.summarize(state);
    const unit = $('opt-unit').value.trim() || '개';

    const notes = [
      ...state.issues.map((i) => (i.person ? `${i.person}: ${i.message.replace(new RegExp(`^${i.person}\\s*[:：]\\s*`), '')}` : i.message)),
      ...(s.hasMenu ? s.unmatched.map((u) => `'${u.name}' 은(는) 메뉴판에 없어서 금액에서 빠졌어요. 아래에서 메뉴를 골라 주세요.`) : []),
    ];
    $('issues').hidden = !notes.length;
    $('issues').replaceChildren(el('b', { textContent: '확인이 필요해요' }), el('ul', {}, ...notes.map((t) => el('li', { textContent: t }))));

    $('people').replaceChildren(
      ...C.personTotals(state).map((pt, pi) => {
        const person = state.people[pi];
        return el(
          'div',
          { className: 'person' },
          el('div', { className: 'person-head' }, el('div', { textContent: person.name }), el('span', { textContent: state.menu.length ? C.won(pt.total) : `${pt.qty}${unit}` })),
          ...person.orders.map((o) => orderRow(person, o))
        );
      })
    );

    const stat = (v, l) => el('div', { className: 'stat' }, el('b', { textContent: v }), el('span', { textContent: l }));
    $('stats').replaceChildren(
      stat(`${state.people.length}명`, '주문자'),
      stat(`${s.totalQty}${unit}`, '총 수량'),
      stat(s.hasMenu ? C.won(s.totalPrice) : '-', s.hasMenu ? '합계' : '메뉴판 없음')
    );
    $('kakao').textContent = kakaoText();
  }

  function orderRow(person, o) {
    const row = el('div', { className: `line${state.menu.length && o.menuIndex < 0 ? ' warnline' : ''}` });
    let main;
    if (state.menu.length) {
      main = el('select', { ariaLabel: `${person.name} 메뉴` }, el('option', { value: -1, textContent: `❓ ${o.label} (메뉴판에 없음)` }), ...state.menu.map((m, i) => el('option', { value: i, textContent: m.name })));
      main.value = o.menuIndex;
      main.addEventListener('change', () => {
        o.menuIndex = Number(main.value);
        render();
      });
    } else main = el('span', { textContent: o.label });
    const wrap = el('div', {}, main);
    if (o.option) wrap.append(el('div', { className: 'opt', textContent: o.option }));
    const minus = el('button', { type: 'button', textContent: '−', ariaLabel: '수량 줄이기' });
    const plus = el('button', { type: 'button', textContent: '+', ariaLabel: '수량 늘리기' });
    minus.addEventListener('click', () => {
      o.qty = Math.max(1, o.qty - 1);
      render();
    });
    plus.addEventListener('click', () => {
      o.qty = Math.min(99, o.qty + 1);
      render();
    });
    const del = el('button', { type: 'button', className: 'del', textContent: '삭제', ariaLabel: '주문 삭제' });
    del.addEventListener('click', () => {
      person.orders = person.orders.filter((x) => x !== o);
      state.people = state.people.filter((p) => p.orders.length);
      if (!state.people.length) {
        state = null;
        $('s3').hidden = $('s4').hidden = true;
        return setStep();
      }
      render();
    });
    row.append(wrap, el('div', { className: 'q' }, minus, el('span', { textContent: o.qty }), plus), del);
    return row;
  }

  for (const id of ['opt-prices', 'opt-people', 'opt-title', 'opt-unit']) $(id).addEventListener('input', () => state && render());

  $('copy').addEventListener('click', async () => {
    const text = $('kakao').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea', { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    $('copied').hidden = false;
    setTimeout(() => ($('copied').hidden = true), 2000);
  });

  renderMenu();
})();
