const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function isDataUrl(str) {
  return typeof str === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(str);
}

function assertImage(dataUrl, field = 'image') {
  if (!isDataUrl(dataUrl)) {
    return { ok: false, error: `${field} 는 data:image/...;base64,... 형식의 사진이어야 해요.` };
  }
  const size = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4;
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `사진이 너무 커요(최대 8MB). 크기를 줄여 주세요.` };
  }
  return { ok: true };
}

function sanitizeNames(list, max = 60) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((n) => typeof n === 'string')
    .map((n) => n.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeState(state) {
  const out = { participants: [], expenses: [], settlements: [], totals: {} };
  if (!state || typeof state !== 'object') return out;
  out.participants = (Array.isArray(state.participants) ? state.participants : [])
    .slice(0, 60)
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      name: String(p.name || '').slice(0, 40),
      paid: Number(p.paid) || 0,
      owed: Number(p.owed) || 0,
      net: Number(p.net) || 0,
    }));
  out.expenses = (Array.isArray(state.expenses) ? state.expenses : [])
    .slice(0, 300)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      title: String(e.title || '').slice(0, 80),
      amount: Number(e.amount) || 0,
      currency: String(e.currency || 'KRW').slice(0, 4),
      payer: String(e.payer || '').slice(0, 40),
      beneficiaries: sanitizeNames(e.beneficiaries, 60),
    }));
  out.settlements = (Array.isArray(state.settlements) ? state.settlements : [])
    .slice(0, 120)
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      from: String(s.from || '').slice(0, 40),
      to: String(s.to || '').slice(0, 40),
      amount: Number(s.amount) || 0,
    }));
  if (state.totals && typeof state.totals === 'object') {
    out.totals = { total: Number(state.totals.total) || 0, count: Number(state.totals.count) || 0 };
  }
  return out;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

module.exports = { ALLOWED_TYPES, MAX_IMAGE_BYTES, isDataUrl, assertImage, sanitizeNames, sanitizeState, sanitizeHistory };
