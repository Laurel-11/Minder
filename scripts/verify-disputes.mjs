// Chaperone feasibility check #2: Gemini 3.8 + alternative ways to open a sandbox dispute.
// Run on the user's computer. Writes a secret-free report to logs/verify2-result.json and logs/验证结果2.txt.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'logs');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'sandbox-state.json');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const PAYPAL = 'https://api-m.sandbox.paypal.com';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
const PORT = 3939;

function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadEnv();
const secrets = [env.PAYPAL_CLIENT_SECRET, env.GEMINI_API_KEY].filter((s) => s && s.length > 6);
const redact = (v) => {
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  for (const sec of secrets) s = s.split(sec).join('***');
  return s.replace(/A21AA[\w-]{20,}/g, 'A21AA***');
};
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

const report = { startedAt: new Date().toISOString(), node: process.version, steps: [], attempts: [] };
function save() {
  fs.writeFileSync(path.join(LOG_DIR, 'verify2-result.json'), redact(JSON.stringify(report, null, 2)));
  const lines = [`Chaperone 验证结果（第 2 轮）  ${new Date().toLocaleString()}`, ''];
  for (const s of report.steps) lines.push(`${s.ok ? '[通过]' : '[失败]'} ${s.name}：${s.summary}`);
  fs.writeFileSync(path.join(LOG_DIR, '验证结果2.txt'), lines.join('\r\n'));
}
function record(name, ok, summary) {
  report.steps.push({ name, ok, summary: redact(summary) });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}：${summary}`);
  save();
}
const uuid = () => crypto.randomUUID();
const TIMEOUT_MS = 25000;
const say = (msg) => console.log(`  …${msg}`);
async function fetchT(url, opts = {}, ms = TIMEOUT_MS) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error(`等了 ${ms / 1000} 秒没有回应（网络不通或对方太忙）：${new URL(url).host}`);
    throw e;
  }
}
const netError = (e) => `${e.name}: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;
async function pp(method, url, { token, body, headers = {}, form } = {}) {
  const h = { Authorization: `Bearer ${token}`, ...headers };
  let payload;
  if (form) payload = form;
  else {
    h['Content-Type'] = 'application/json';
    if (body !== undefined) payload = JSON.stringify(body);
  }
  const res = await fetchT(PAYPAL + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json, debugId: res.headers.get('paypal-debug-id') };
}
const ppErr = (r) => {
  const j = r.json || {};
  return `HTTP ${r.status} ${j.name || j.error || ''} ${j.details?.[0]?.issue || ''} ${j.message || j.error_description || ''} ${j.details?.[0]?.description || ''}`.replace(/\s+/g, ' ').trim();
};

let resolveReturn;
const returned = new Promise((r) => (resolveReturn = r));
const page = (t, b) => `<!doctype html><meta charset="utf-8"><title>${t}</title><body style="font-family:system-ui,'Microsoft YaHei',sans-serif;max-width:640px;margin:60px auto;padding:0 16px;line-height:1.7"><h2>${t}</h2>${b}</body>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u.pathname === '/return') { resolveReturn(true); res.end(page('授权成功', '<p>测试正在继续，结果会显示在黑色窗口里。现在可以关掉这个网页。</p>')); }
  else if (u.pathname === '/cancel') { resolveReturn(false); res.end(page('已取消', '<p>可以关掉这个网页。</p>')); }
  else res.end(page('Chaperone 验证程序', '<p>正在运行，请看黑色窗口。</p>'));
});
const openBrowser = (url) => exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`, () => {});

async function getToken() {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetchT(`${PAYPAL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal token HTTP ${r.status} ${j.error || ''}`);
  return j.access_token;
}

async function ensureVault(token) {
  if (state.vaultId) return state.vaultId;
  const setup = await pp('POST', '/v3/vault/setup-tokens', {
    token,
    headers: { 'PayPal-Request-Id': uuid() },
    body: { payment_source: { paypal: {
      description: 'Chaperone: let your AI shopping agent pay with PayPal, under your rules',
      permit_multiple_payment_tokens: false, usage_pattern: 'IMMEDIATE', usage_type: 'MERCHANT', customer_type: 'CONSUMER',
      experience_context: { brand_name: 'Chaperone', locale: 'en-US', shipping_preference: 'NO_SHIPPING',
        return_url: `http://localhost:${PORT}/return`, cancel_url: `http://localhost:${PORT}/cancel` },
    } } },
  });
  if (!setup.ok) throw new Error(`setup token: ${ppErr(setup)}`);
  const approve = setup.json.links.find((l) => l.rel === 'approve').href;
  await new Promise((r) => server.listen(PORT, r));
  console.log('\n================================================================');
  console.log('需要再登录一次：请在弹出的网页里用美国"个人"沙盒账号登录，选 Visa 信用卡，点 Agree and Continue。');
  console.log('这次之后会把授权保存下来，以后的测试不用再登录。网页没弹出的话，复制这个链接打开：');
  console.log(approve);
  console.log('================================================================\n');
  openBrowser(approve);
  const ok = await Promise.race([returned, new Promise((r) => setTimeout(() => r(null), 10 * 60 * 1000))]);
  if (!ok) throw new Error('没有完成登录授权');
  const pt = await pp('POST', '/v3/vault/payment-tokens', {
    token, headers: { 'PayPal-Request-Id': uuid() },
    body: { payment_source: { token: { id: setup.json.id, type: 'SETUP_TOKEN' } } },
  });
  if (!pt.ok) throw new Error(`payment token: ${ppErr(pt)}`);
  state.vaultId = pt.json.id;
  state.customerId = pt.json.customer?.id;
  state.vaultSavedAt = new Date().toISOString();
  saveState();
  return state.vaultId;
}

async function payWithVault(token, vaultId, value, description) {
  const o = await pp('POST', '/v2/checkout/orders', {
    token, headers: { 'PayPal-Request-Id': uuid() },
    body: { intent: 'CAPTURE', purchase_units: [{ description, amount: { currency_code: 'USD', value } }], payment_source: { paypal: { vault_id: vaultId } } },
  });
  if (!o.ok) throw new Error(`order: ${ppErr(o)}`);
  const cap = o.json.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap) throw new Error(`order status ${o.json.status}, no capture`);
  return { orderId: o.json.id, captureId: cap.id, captureStatus: cap.status };
}

async function main() {
  console.log('Chaperone 验证程序（第 2 轮）：开始\n');

  // 1. A fresh captured payment from Maya
  say('正在连接 PayPal');
  const token = await getToken();
  say('PayPal 已连上，正在用保存的授权付款');
  let pay;
  try {
    const vaultId = await ensureVault(token);
    pay = await payWithVault(token, vaultId, '25.00', 'Bluetooth speaker from QuickGadgets (never shipped) - Chaperone test');
    state.lastCaptureId = pay.captureId;
    saveState();
    record('用保存的授权付款', true, `成功：直接扣款 $25，没有再让 Maya 登录（状态 ${pay.captureStatus}）`);
  } catch (e) {
    record('用保存的授权付款', false, e.message);
    return;
  }

  say('正在尝试发起争议');
  // 2. Try to open a dispute WITHOUT the buyer assertion header (app token has disputes/create scope)
  await new Promise((r) => setTimeout(r, 5000));
  const variants = [
    ['no-assertion, buyer_transaction_id', { buyer_transaction_id: pay.captureId }],
    ['no-assertion, seller_transaction_id', { seller_transaction_id: pay.captureId }],
  ];
  let created = null;
  for (const [label, tx] of variants) {
    const input = {
      disputed_transactions: [tx],
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      dispute_amount: { currency_code: 'USD', value: '25.00' },
      extensions: { merchant_contacted: false },
    };
    const fd = new FormData();
    fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json');
    const r = await pp('POST', '/v1/customer/disputes', { token, form: fd });
    report.attempts.push({ label, status: r.status, error: r.ok ? null : ppErr(r), debugId: r.debugId, body: r.json });
    save();
    if (r.ok) { created = { label, r }; break; }
  }
  if (created) {
    const id = (created.r.json?.links || []).find((l) => l.rel === 'self')?.href?.split('/').pop();
    state.disputeId = id;
    saveState();
    record('程序发起争议', true, `成功（${created.label}）：争议编号 ${id}`);
  } else {
    record('程序发起争议', false, `不带买家声明也不行：${report.attempts.map((a) => a.error).join(' | ')}`);
  }

  say('正在读取争议列表');
  // 3. Whatever happened, list disputes and show the first one's available actions
  try {
    const list = await pp('GET', '/v1/customer/disputes?page_size=10', { token });
    const items = list.json?.items || [];
    report.disputes = items.map((d) => ({ id: d.dispute_id, status: d.status, reason: d.reason, amount: d.dispute_amount?.value, stage: d.dispute_life_cycle_stage }));
    if (items[0]) {
      const d = await pp('GET', `/v1/customer/disputes/${items[0].dispute_id}`, { token });
      report.firstDispute = { id: d.json?.dispute_id, status: d.json?.status, stage: d.json?.dispute_life_cycle_stage, actions: (d.json?.links || []).map((l) => l.rel) };
    }
    record('查看争议列表', list.ok, list.ok ? `商家一侧共有 ${items.length} 条争议` : ppErr(list));
  } catch (e) {
    record('查看争议列表', false, netError(e));
  }
  // 4. Gemini (last, so a slow AI service never blocks the PayPal tests)
  say('正在连接 Gemini（最多试 4 个模型）');
  const gemErrors = [];
  let gemOk = false;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 2 && !gemOk; attempt++) {
      try {
        const g = await fetchT(`${GEMINI}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly one word: OK' }] }] }),
        });
        const gj = await g.json();
        if (g.ok) {
          const text = gj.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
          report.geminiModel = model;
          record('连接 Gemini', true, `成功，${model} 回复了"${text.trim()}"`);
          gemOk = true;
        } else {
          gemErrors.push(`${model}: HTTP ${g.status} ${gj.error?.status || ''}`);
          say(`${model} 暂时不可用（HTTP ${g.status}），换下一个`);
          if (g.status !== 503 && g.status !== 429) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (e) {
        gemErrors.push(`${model}: ${e.message}`);
        say(`${model}：${e.message}`);
        break;
      }
    }
    if (gemOk) break;
  }
  if (!gemOk) record('连接 Gemini', false, gemErrors.join(' | '));
}

main()
  .catch((e) => record('意外错误', false, netError(e)))
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    save();
    console.log('\n全部测试结束。结果已保存到 logs\\验证结果2.txt，Claude 能直接读到。可以关掉这个窗口了。');
    server.close();
    setTimeout(() => process.exit(0), 300);
  });
