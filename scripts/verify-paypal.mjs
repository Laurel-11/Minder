// Minder feasibility check.
// Runs on the user's computer (it needs to reach PayPal sandbox and Gemini).
// Tests: PayPal auth, Gemini, Vault (save PayPal once), Authorize/Void/Capture, sandbox dispute creation.
// Writes a secret-free report to logs/verify-result.json and logs/验证结果.txt.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const PAYPAL = 'https://api-m.sandbox.paypal.com';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';
const PORT = 3939;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// ---------- helpers ----------
function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  const env = {};
  if (!fs.existsSync(file)) return env;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const secrets = [env.PAYPAL_CLIENT_SECRET, env.GEMINI_API_KEY].filter((s) => s && s.length > 6);
function redact(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  for (const sec of secrets) s = s.split(sec).join('***');
  s = s.replace(/A21AA[\w-]{20,}/g, 'A21AA***'); // PayPal access tokens
  return s;
}

const report = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, steps: [] };
function record(name, ok, summary, detail) {
  const step = { name, ok, summary };
  if (detail !== undefined) step.detail = JSON.parse(redact(detail ?? null));
  report.steps.push(step);
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}：${summary}`);
  save();
}
function save() {
  fs.writeFileSync(path.join(LOG_DIR, 'verify-result.json'), redact(JSON.stringify(report, null, 2)));
  const lines = [`Minder 验证结果  ${new Date().toLocaleString()}`, `Node.js ${report.node}`, ''];
  for (const s of report.steps) lines.push(`${s.ok ? '[通过]' : '[失败]'} ${s.name}：${s.summary}`);
  fs.writeFileSync(path.join(LOG_DIR, '验证结果.txt'), lines.join('\r\n'));
}
const uuid = () => crypto.randomUUID();
const netError = (e) => `${e.name}: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;

async function pp(method, url, { token, body, headers = {}, form } = {}) {
  const h = { Authorization: `Bearer ${token}`, ...headers };
  let payload;
  if (form) payload = form;
  else {
    h['Content-Type'] = 'application/json';
    if (body !== undefined) payload = JSON.stringify(body);
  }
  const res = await fetch(PAYPAL + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json, debugId: res.headers.get('paypal-debug-id') };
}
function ppErr(r) {
  const j = r.json || {};
  const issue = j.details?.[0]?.issue || '';
  const desc = j.details?.[0]?.description || '';
  return `HTTP ${r.status} ${j.name || j.error || ''} ${issue} ${j.message || j.error_description || ''} ${desc}`.replace(/\s+/g, ' ').trim();
}

// ---------- local page for the one-time PayPal login ----------
let resolveReturn;
const returned = new Promise((r) => (resolveReturn = r));
const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,'Microsoft YaHei',sans-serif;max-width:640px;margin:60px auto;padding:0 16px;line-height:1.7"><h2>${title}</h2>${body}</body>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u.pathname === '/return') {
    resolveReturn({ approved: true, query: Object.fromEntries(u.searchParams) });
    res.end(page('授权成功', '<p>测试正在继续，大约 30 秒。</p><p>结果会显示在黑色窗口里，现在可以关掉这个网页。</p>'));
  } else if (u.pathname === '/cancel') {
    resolveReturn({ approved: false, query: Object.fromEntries(u.searchParams) });
    res.end(page('已取消授权', '<p>可以关掉这个网页，回到黑色窗口。</p>'));
  } else {
    res.end(page('Minder 验证程序', '<p>正在运行，请看黑色窗口。</p>'));
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// ---------- tests ----------
async function main() {
  console.log('Minder 验证程序：开始\n');

  const missing = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BUYER_EMAIL', 'GEMINI_API_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    record('读取密钥', false, `.env.local 里这些还没填：${missing.join('、')}。请先双击 2-填写密钥.bat 填好再运行。`);
    return;
  }
  record('读取密钥', true, '.env.local 里的 4 项都已填写');

  // 1. PayPal access token
  let token;
  try {
    const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const r = await fetch(`${PAYPAL}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const j = await r.json();
    if (!r.ok) {
      record('连接 PayPal', false, `登录被拒绝（HTTP ${r.status} ${j.error || ''}）。多半是 Client ID 或 Secret 填错了`, j);
      return;
    }
    token = j.access_token;
    const scopes = (j.scope || '').split(' ');
    report.scopes = scopes;
    const disputeScopes = scopes.filter((s) => s.includes('disputes'));
    record('连接 PayPal', true, `成功，应用拿到 ${scopes.length} 项权限；其中和争议有关的：${disputeScopes.length ? disputeScopes.join('、') : '无'}`);
  } catch (e) {
    record('连接 PayPal', false, `网络连不上 PayPal：${netError(e)}`);
    return;
  }

  // 2. Gemini
  try {
    const list = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    const lj = await list.json();
    if (!list.ok) {
      record('连接 Gemini', false, `HTTP ${list.status} ${lj.error?.status || ''} ${lj.error?.message || ''}`.trim());
    } else {
      report.geminiModels = (lj.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace('models/', ''));
      const g = await fetch(`${GEMINI}/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly one word: OK' }] }] }),
      });
      const gj = await g.json();
      if (!g.ok) record('连接 Gemini', false, `模型 ${GEMINI_MODEL} 调用失败：HTTP ${g.status} ${gj.error?.status || ''} ${gj.error?.message || ''}`.trim());
      else {
        const text = gj.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        record('连接 Gemini', true, `成功，${GEMINI_MODEL} 回复了"${text.trim()}"；你的 key 可用 ${report.geminiModels.length} 个模型`);
      }
    }
  } catch (e) {
    record('连接 Gemini', false, `网络连不上 Gemini：${netError(e)}（可能需要开 VPN）`);
  }

  // 3. Disputes feature (merchant side)
  try {
    const r = await pp('GET', '/v1/customer/disputes?page_size=5', { token });
    if (r.ok) record('争议功能（商家一侧）', true, `已开通，当前有 ${r.json?.items?.length || 0} 条争议`);
    else record('争议功能（商家一侧）', false, ppErr(r), r.json);
  } catch (e) {
    record('争议功能（商家一侧）', false, netError(e));
  }

  // 4. Vault: save the buyer's PayPal once
  let vaultId;
  try {
    const setup = await pp('POST', '/v3/vault/setup-tokens', {
      token,
      headers: { 'PayPal-Request-Id': uuid() },
      body: {
        payment_source: {
          paypal: {
            description: 'Minder: let your AI shopping agent pay with PayPal, under your rules',
            permit_multiple_payment_tokens: false,
            usage_pattern: 'IMMEDIATE',
            usage_type: 'MERCHANT',
            customer_type: 'CONSUMER',
            experience_context: {
              brand_name: 'Minder',
              locale: 'en-US',
              shipping_preference: 'NO_SHIPPING',
              return_url: `http://localhost:${PORT}/return`,
              cancel_url: `http://localhost:${PORT}/cancel`,
            },
          },
        },
      },
    });
    if (!setup.ok) {
      record('一次授权（Vault）', false, `创建授权请求失败：${ppErr(setup)}。可能是 Save payment methods 没勾上或没保存`, setup.json);
    } else {
      const approve = (setup.json.links || []).find((l) => l.rel === 'approve')?.href;
      await new Promise((r) => server.listen(PORT, r));
      console.log('\n================================================================');
      console.log('请在马上弹出的网页里，用美国"个人"沙盒账号登录 PayPal，然后点同意（Agree / Continue）。');
      console.log('如果网页没有自动弹出，把下面这个链接复制到浏览器打开：');
      console.log(approve);
      console.log('================================================================\n');
      openBrowser(approve);
      const result = await Promise.race([returned, new Promise((r) => setTimeout(() => r(null), LOGIN_TIMEOUT_MS))]);
      if (!result) record('一次授权（Vault）', false, '10 分钟内没有完成登录授权，测试提前结束');
      else if (!result.approved) record('一次授权（Vault）', false, '你点了取消，测试提前结束');
      else {
        report.returnQuery = Object.keys(result.query);
        const pt = await pp('POST', '/v3/vault/payment-tokens', {
          token,
          headers: { 'PayPal-Request-Id': uuid() },
          body: { payment_source: { token: { id: setup.json.id, type: 'SETUP_TOKEN' } } },
        });
        if (!pt.ok) record('一次授权（Vault）', false, `登录成功，但保存付款方式失败：${ppErr(pt)}`, pt.json);
        else {
          vaultId = pt.json.id;
          record('一次授权（Vault）', true, '成功：Maya 授权一次后，程序拿到了可以反复使用的付款凭证');
        }
      }
    }
  } catch (e) {
    record('一次授权（Vault）', false, netError(e));
  }
  if (!vaultId) return;

  // 5. Authorize (hold) with the saved payment method, then void / capture
  async function authorizeOrder(value, description) {
    const o = await pp('POST', '/v2/checkout/orders', {
      token,
      headers: { 'PayPal-Request-Id': uuid() },
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [{ description, amount: { currency_code: 'USD', value } }],
        payment_source: { paypal: { vault_id: vaultId } },
      },
    });
    if (!o.ok) return { error: `创建订单失败：${ppErr(o)}`, raw: o.json };
    let order = o.json;
    let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      const a = await pp('POST', `/v2/checkout/orders/${order.id}/authorize`, { token, headers: { 'PayPal-Request-Id': uuid() }, body: {} });
      if (!a.ok) return { error: `订单状态 ${order.status}，冻结失败：${ppErr(a)}`, raw: a.json };
      order = a.json;
      auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    }
    if (!auth) return { error: `订单状态 ${order.status}，但没有拿到冻结记录`, raw: order };
    return { orderId: order.id, orderStatus: order.status, authId: auth.id, authStatus: auth.status };
  }

  let captureId;
  try {
    const held = await authorizeOrder('129.00', 'Wireless headphones (birthday gift) - Minder test');
    if (held.error) record('授权冻结 → 释放', false, held.error, held.raw);
    else {
      const v = await pp('POST', `/v2/payments/authorizations/${held.authId}/void`, { token, headers: { 'PayPal-Request-Id': uuid() } });
      if (v.status === 204 || v.ok) record('授权冻结 → 释放', true, `成功：冻结 $129（状态 ${held.authStatus}），随后释放，Maya 一分钱没花`);
      else record('授权冻结 → 释放', false, `冻结成功但释放失败：${ppErr(v)}`, v.json);
    }

    const held2 = await authorizeOrder('18.00', 'Coffee beans 1kg - Minder test');
    if (held2.error) record('授权冻结 → 正式扣款', false, held2.error, held2.raw);
    else {
      const c = await pp('POST', `/v2/payments/authorizations/${held2.authId}/capture`, { token, headers: { 'PayPal-Request-Id': uuid() }, body: { final_capture: true } });
      if (c.ok) {
        captureId = c.json.id;
        record('授权冻结 → 正式扣款', true, `成功：冻结 $18 后正式扣款，状态 ${c.json.status}`);
      } else record('授权冻结 → 正式扣款', false, `冻结成功但扣款失败：${ppErr(c)}`, c.json);
    }
  } catch (e) {
    record('授权冻结', false, netError(e));
  }
  if (!captureId) return;

  // 6. Sandbox dispute creation on the buyer's behalf
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ iss: env.PAYPAL_CLIENT_ID, email: env.PAYPAL_BUYER_EMAIL })}.`;
  const attempts = [];
  async function tryCreate(label, disputedTx, asString) {
    const input = {
      disputed_transactions: [disputedTx],
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      dispute_amount: { currency_code: 'USD', value: '18.00' },
      extensions: { merchant_contacted: false },
    };
    const fd = new FormData();
    if (asString) fd.append('input', JSON.stringify(input));
    else fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json');
    const r = await pp('POST', '/v1/customer/disputes', { token, form: fd, headers: { 'PayPal-Auth-Assertion': assertion } });
    attempts.push({ label, status: r.status, error: r.ok ? null : ppErr(r), debugId: r.debugId, body: r.json });
    return r;
  }
  try {
    // Give PayPal a moment to settle the capture.
    await new Promise((r) => setTimeout(r, 5000));
    let ok = null;
    const variants = [
      ['buyer_transaction_id=capture', { buyer_transaction_id: captureId }, false],
      ['seller_transaction_id=capture', { seller_transaction_id: captureId }, false],
      ['buyer_transaction_id=capture (text field)', { buyer_transaction_id: captureId }, true],
    ];
    for (const [label, tx, asString] of variants) {
      const r = await tryCreate(label, tx, asString);
      if (r.ok) { ok = { label, r }; break; }
    }
    report.disputeAttempts = attempts;
    if (ok) {
      const link = (ok.r.json?.links || []).find((l) => l.rel === 'self')?.href || '';
      record('沙盒里代买家发起争议', true, `成功（${ok.label}）：${link.split('/').pop()}`);
    } else {
      record('沙盒里代买家发起争议', false, `三种方式都没成功。第一种的错误：${attempts[0]?.error || '未知'}`, attempts.map(({ body, ...a }) => a));
    }
  } catch (e) {
    record('沙盒里代买家发起争议', false, netError(e));
  }
}

main()
  .catch((e) => record('意外错误', false, netError(e)))
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    save();
    console.log('\n全部测试结束。结果已保存到 logs\\验证结果.txt，Claude 能直接读到。可以关掉这个窗口了。');
    server.close();
    setTimeout(() => process.exit(0), 300);
  });
