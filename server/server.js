const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('./lib/ai');
const orders = require('./lib/orders');
const { assertImage, sanitizeNames, sanitizeState, sanitizeHistory } = require('./lib/validate');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const PRIVATE_PATHS = [/^\/\.env/, /^\/server\//, /^\/node_modules\//, /^\/package/, /^\/\.git\//, /^\/(\.DS_Store|README)/];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readJson(req, limitBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, '보내는 양이 너무 커요(사진은 8MB까지).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
        resolve(parsed);
      } catch {
        reject(new HttpError(400, '보낸 데이터가 JSON 형식이 아니에요.'));
      }
    });
    req.on('error', reject);
  });
}

// ---- 간단한 주소별 속도 제한 ----
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    }
    return true;
  };
}
const limitAi = createLimiter({ windowMs: 60_000, max: Number(process.env.AI_RATE_PER_MIN || 20) });
const limitGeneral = createLimiter({ windowMs: 60_000, max: 120 });

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

// ---- 라우트 ----
const routes = {
  'POST /api/health': async () => ({
    ok: true,
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || orders.DEFAULT_MODEL,
  }),

  'POST /api/receipt': async (body) => {
    const check = assertImage(body.image);
    if (!check.ok) throw new HttpError(400, check.error);
    return ai.extractReceipt(body.image);
  },

  'POST /api/orders-text': async (body) => {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, '분석할 글을 붙여 넣어 주세요.');
    if (text.length > 20000) throw new HttpError(400, '글은 20,000자까지 분석할 수 있어요.');
    return ai.extractOrdersText(text, sanitizeNames(body.participants));
  },

  'POST /api/order/menu': async (body) => {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > orders.MAX_MENU_TEXT) throw new HttpError(400, '메뉴 글이 너무 길어요.');
    let image = null;
    if (body.image) {
      const check = assertImage(body.image);
      if (!check.ok) throw new HttpError(400, check.error);
      image = body.image;
    }
    if (!text && !image) throw new HttpError(400, '가격표 글이나 메뉴판 사진을 넣어 주세요.');
    return orders.parseMenu({ text, image });
  },

  'POST /api/order/analyze': async (body) => {
    const chat = typeof body.chat === 'string' ? body.chat.trim() : '';
    if (!chat) throw new HttpError(400, '카톡 대화를 붙여 넣어 주세요.');
    if (chat.length > orders.MAX_CHAT) throw new HttpError(400, `대화는 ${orders.MAX_CHAT.toLocaleString()}자까지 분석할 수 있어요.`);
    const menuText = typeof body.menuText === 'string' ? body.menuText.trim() : '';
    if (menuText.length > orders.MAX_MENU_TEXT) throw new HttpError(400, '메뉴 글이 너무 길어요.');
    let menuImage = null;
    if (body.menuImage) {
      const check = assertImage(body.menuImage, 'menuImage');
      if (!check.ok) throw new HttpError(400, check.error);
      menuImage = body.menuImage;
    }
    return orders.analyze({ chat, menuText, menuImage, menu: body.menu });
  },

  'POST /api/menu-image': async (body) => {
    const check = assertImage(body.image);
    if (!check.ok) throw new HttpError(400, check.error);
    return ai.extractMenuImage(body.image);
  },

  'POST /api/summarize': async (body) => {
    const state = sanitizeState(body.state);
    if (!state.participants.length && !state.expenses.length) {
      throw new HttpError(400, '참가자와 지출을 먼저 넣어 주세요.');
    }
    return ai.summarizeExpenses(state);
  },

  'POST /api/chat': async (body) => {
    const history = sanitizeHistory(body.messages);
    if (!history.length || history[history.length - 1].role !== 'user') {
      throw new HttpError(400, '질문을 한 줄 적어 주세요.');
    }
    return ai.chat(history, sanitizeState(body.state));
  },
};

async function handleApi(req, res, url) {
  const key = `${req.method} ${url.pathname}`;
  const handler = key === 'GET /api/health' ? routes['POST /api/health'] : routes[key];
  if (!handler) return sendJson(res, 404, { error: '없는 API예요.' });
  const ip = clientIp(req);
  if (!limitAi(ip)) throw new HttpError(429, 'AI 요청이 너무 잦아요. 1분 뒤에 다시 시도해 주세요.');
  const body = await readJson(req);
  const started = Date.now();
  const result = await handler(body);
  console.log(`[ai] ${key} ${Date.now() - started}ms ip=${ip.slice(0, 24)}`);
  sendJson(res, 200, result);
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '주소가 올바르지 않아요.');
  }
  if (pathname.includes('\0')) throw new HttpError(400, '주소가 올바르지 않아요.');
  if (PRIVATE_PATHS.some((re) => re.test(pathname))) throw new HttpError(404, '없는 파일이에요.');
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep)) throw new HttpError(404, '없는 파일이에요.');
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('없는 파일이에요.');
    }
    const type = STATIC_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'cache-control': /\.(html|css|js)$/.test(filePath) ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/')) {
      const apiKey = url.pathname === '/api/health' ? 'POST /api/health' : `${req.method} ${url.pathname}`;
      const handler = routes[apiKey];
      if (!handler) throw new HttpError(404, '없는 API예요.');
      return sendJson(res, 200, await handler({}));
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!limitGeneral(clientIp(req))) throw new HttpError(429, '요청이 너무 잦아요.');
      return serveStatic(req, res, url);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    throw new HttpError(405, '지원하지 않는 요청이에요.');
  } catch (err) {
    const status = err.status || (err.name === 'AbortError' ? 504 : 500);
    let message = status === 500 ? '서버에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' : err.message;
    if (err.status === 401) message = 'OpenAI 키가 올바르지 않아요. .env 의 OPENAI_API_KEY 를 확인하세요.';
    if (err.status === 429 && !err.message.includes('잦')) message = 'OpenAI 사용 한도에 걸렸어요. 잠시 뒤 다시 시도하세요.';
    if (status >= 500) console.error('[error]', req.method, url.pathname, err.name, err.message);
    if (!res.headersSent) sendJson(res, status, { error: message });
    else res.end();
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`총무해방 서버: http://localhost:${PORT}`);
    console.log(`OpenAI 키: ${process.env.OPENAI_API_KEY ? '있음' : '없음 (.env 에 OPENAI_API_KEY 를 넣어 주세요)'}`);
    console.log(`모델: ${process.env.OPENAI_MODEL || orders.DEFAULT_MODEL}`);
    console.log(`주문 정리: http://localhost:${PORT}/order.html`);
  });
}

module.exports = { server, createLimiter };
