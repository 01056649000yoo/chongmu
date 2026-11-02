const OpenAI = require('openai');

const CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR', 'CNY', 'GBP'];

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      maxRetries: 1,
      timeout: Number(process.env.AI_TIMEOUT_MS || 60000),
    });
  }
  return client;
}

const extractionFormat = (name, schema) => ({
  type: 'json_schema',
  name,
  strict: true,
  schema,
});

const amountSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    amount: { type: 'number' },
    currency: { type: 'string', enum: CURRENCIES },
    date: { type: ['string', 'null'] },
    suggestedPayerName: { type: ['string', 'null'] },
    suggestedSharedBy: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['title', 'amount', 'currency', 'date', 'suggestedPayerName', 'suggestedSharedBy', 'confidence'],
  additionalProperties: false,
};

const singleExpenseSchema = {
  type: 'object',
  properties: {
    isExpense: { type: 'boolean' },
    expense: { anyOf: [amountSchema, { type: 'null' }] },
    note: { type: 'string' },
  },
  required: ['isExpense', 'expense', 'note'],
  additionalProperties: false,
};

const expenseListSchema = {
  type: 'object',
  properties: {
    expenses: { type: 'array', items: amountSchema },
    notes: { type: 'string' },
  },
  required: ['expenses', 'notes'],
  additionalProperties: false,
};

const summarySchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    perPerson: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          paid: { type: 'number' },
          owed: { type: 'number' },
          net: { type: 'number' },
        },
        required: ['name', 'paid', 'owed', 'net'],
        additionalProperties: false,
      },
    },
    transfers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['from', 'to', 'amount'],
        additionalProperties: false,
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'perPerson', 'transfers', 'tips'],
  additionalProperties: false,
};

const BASE = `너는 여행 정산 앱 '총무해방'의 도우미다. 사용자는 여행 총무다.
모르는 값은 지어내지 말고 null 또는 빈 배열로 두고, 애매하면 note/tips 에 짧게 적어라.
금액은 숫자만 넣어라(쉼표·통화기호 없이). 통화를 모르면 KRW 로 둔다.`;

async function run({ input, format, instructions }) {
  const ai = getClient();
  if (!ai) {
    const err = new Error('서버에 OPENAI_API_KEY 가 없습니다. .env 를 확인하세요.');
    err.status = 503;
    throw err;
  }
  const res = await ai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
    reasoning: { effort: process.env.OPENAI_REASONING || 'low' },
    instructions,
    input,
    text: { format },
  });
  if (res.output_parsed == null) {
    const err = new Error('모델이 구조화된 결과를 돌려주지 않았습니다. 다시 시도하세요.');
    err.status = 502;
    throw err;
  }
  return res.output_parsed;
}

function imagePart(dataUrl) {
  return { type: 'input_image', image_url: dataUrl, detail: 'high' };
}

async function extractReceipt(imageDataUrl) {
  return run({
    instructions: `${BASE}
사진은 영수증, 메뉴판, 주문 내역, 결제 화면 중 하나다.
- 영수증/결제 화면이면 처음 한 건이면 isExpense=true 와 합계(총액) 한 건을 넣는다. title 은 가게 이름이나 결제 내용 요약.
- 메뉴판 사진이면 isExpense=false 로 두고 note 에 무엇이 적혀 있는지 한두 문장으로 적는다(가격이 보이면 note 에 포함).
합계가 여러 개 보이면(부가세 포함 등) 최종 결제 금액을 쓴다.`,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '이 사진에서 지출 한 건을 뽑아 주세요.' },
          imagePart(imageDataUrl),
        ],
      },
    ],
    format: extractionFormat('receipt_extraction', singleExpenseSchema),
  });
}

async function extractOrdersText(text, participants) {
  return run({
    instructions: `${BASE}
사용자가 붙인 글에서 날짜별 지출을 빠짐없이 뽑는다. 여러 건이면 각각 한 항목으로.
참고 참가자 이름(맞춤은 이름이 정확히 보일 때만): ${(participants || []).join(', ') || '(없음)'}
- 주문/영수증/메뉴 글을 붙였다면(예: '아메리카노 2, 라떼 1') 항목 이름에 '음료' 처럼 주문 종류를 적고 줄 합계를 amount 로.
- 날짜는 YYYY-MM-DD 형식, 없으면 null.`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: text.slice(0, 20000) }] }],
    format: extractionFormat('orders_extraction', expenseListSchema),
  });
}

async function extractMenuImage(imageDataUrl) {
  return run({
    instructions: `${BASE}
사진이 메뉴판/가격표면 보이는 모든 메뉴와 가격을 한 건씩 뽑는다. title 은 메뉴 이름.
사진이 주문 영수증이면 각 주문 항목(음료 이름과 수량이 있으면 '아메리카노 2잔' 처럼)을 한 건씩 뽑고, amount 는 그 항목의 줄 합계.
같은 항목의 수량/단가는 note 에 적어라.`,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '메뉴판·주문 사진에서 항목과 가격을 뽑아 주세요.' },
          imagePart(imageDataUrl),
        ],
      },
    ],
    format: extractionFormat('menu_extraction', expenseListSchema),
  });
}

async function summarizeExpenses(context) {
  const payload = JSON.stringify(context, null, 0).slice(0, 60000);
  return run({
    instructions: `${BASE}
정산 결과(참가자별 지불·부담·순액, 최소 송금 목록)를 받았다.
1) summary: 총무가 읽기 쉬운 3~5문장 요약(총 지출, 누가 가장 많이 냈는지, 지금 한 번에 정산하면 되는지, 이상해 보이는 부분).
2) perPerson, transfers: 받은 값을 그대로 옮긴다(이름 순서 유지, 계산을 바꾸지 않는다).
3) tips: 절약·따라잡기·다음에 나눌 때 좋은 1~3가지 짧은 조언.
정산 숫자가 서로 안 맞아 보이면 summary 와 tips 에 짚어 준다.`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: payload }] }],
    format: extractionFormat('settlement_summary', summarySchema),
  });
}

async function chat(history, context) {
  const ai = getClient();
  if (!ai) {
    const err = new Error('서버에 OPENAI_API_KEY 가 없습니다. .env 를 확인하세요.');
    err.status = 503;
    throw err;
  }
  const ctx = JSON.stringify(context, null, 0).slice(0, 60000);
  const res = await ai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
    reasoning: { effort: process.env.OPENAI_REASONING || 'low' },
    instructions: `${BASE}
여행 총무와 대화한다. 짧고 친근한 존댓말, 3문장 이내(꼭 필요할 때만 길게).
현재 정산 데이터(JSON): ${ctx}
- 숫자는 이 데이터를 근거로 답한다. 직접 더해야 하면 계산하고 계산 과정은 한 줄로.
- 데이터가 비어 있으면 참가자·지출을 먼저 넣으라고 안내한다.
- 앱 기능: 참가자 추가, 지출 추가(통화·환율), 영수증·메뉴판·주문 사진으로 지출 자동 입력, '정산 AI 설명'(요약), 세션 코드로 여러 명 함께 편집.`,
    input: history.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000),
    })),
  });
  return { reply: res.output_text };
}

module.exports = {
  CURRENCIES,
  getClient,
  extractReceipt,
  extractOrdersText,
  extractMenuImage,
  summarizeExpenses,
  chat,
};
