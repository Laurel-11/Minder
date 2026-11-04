// Minder feasibility check #3: ways to get Maya's money back in the sandbox.
// A) merchant refund after agent-to-agent negotiation  B) escalation via PayPal's sandbox chargeback simulator
// No login needed: reuses the saved Vault token in data/sandbox-state.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'logs');
const STATE_FILE = path.join(ROOT, 'data', 'sandbox-state.json');
fs.mkdirSync(LOG_DIR, { recursive: true });
const PAYPAL = 'https://api-m.sandbox.paypal.com';

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.local');
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
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const secrets = [env.PAYPAL_CLIENT_SECRET, env.GEMINI_API_KEY].filter((s) => s && s.length > 6);
const redact = (v) => {
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  for (const sec of secrets) s = s.split(sec).join('***');
  return s.replace(/A21AA[\w-]{20,}/g, 'A21AA***');
};
const report = { startedAt: new Date().toISOString(), steps: [], raw: {} };
function save() {
  fs.writeFileSync(path.join(LOG_DIR, 'verify3-result.json'), redact(JSON.stringify(report, null, 2)));
  const lines = [`Minder 验证结果（第 3 轮：把钱追回来）  ${new Date().toLocaleString()}`, ''];
  for (const s of report.steps) lines.push(`${s.ok ? '[通过]' : '[失败]'} ${s.name}：${s.summary}`);
  fs.writeFileSync(path.join(LOG_DIR, '验证结果3.txt'), lines.join('\r\n'));
}
function record(name, ok, summary) {
  report.steps.push({ name, ok, summary: redact(summary) });
  console.log(`${ok ? '[通过]' : '[失败]'} ${name}：${summary}`);
  save();
}
const say = (m) => console.log(`  …${m}`);
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchT(url, opts = {}, ms = 25000) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
  catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error(`等了 ${ms / 1000} 秒没有回应：${new URL(url).host}`);
    throw new Error(`${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`);
  }
}
async function pp(method, url, { token, body, headers = {} } = {}) {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers };
  const res = await fetchT(PAYPAL + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json, debugId: res.headers.get('paypal-debug-id') };
}
const ppErr = (r) => {
  const j = r.json || {};
  return `HTTP ${r.status} ${j.name || j.error || ''} ${j.details?.map((d) => d.issue + (d.field ? `@${d.field}` : '')).join(',') || ''} ${j.message || j.error_description || ''}`.replace(/\s+/g, ' ').trim();
};

async function getToken() {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetchT(`${PAYPAL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal 登录失败 HTTP ${r.status}`);
  return j.access_token;
}
async function pay(token, value, description) {
  const o = await pp('POST', '/v2/checkout/orders', {
    token, headers: { 'PayPal-Request-Id': uuid() },
    body: { intent: 'CAPTURE', purchase_units: [{ description, amount: { currency_code: 'USD', value } }], payment_source: { paypal: { vault_id: state.vaultId } } },
  });
  if (!o.ok) throw new Error(`付款失败：${ppErr(o)}`);
  const pu = o.json.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return { orderId: o.json.id, captureId: cap?.id, merchantId: pu?.payee?.merchant_id, status: cap?.status };
}

async function main() {
  console.log('Minder 验证程序（第 3 轮：把钱追回来）：开始\n');
  if (!state.vaultId) { record('读取保存的授权', false, '没找到保存的授权，请先运行 4-验证争议.bat'); return; }
  say('正在连接 PayPal');
  const token = await getToken();

  // A) Agent-to-agent settlement: the merchant refunds part of the payment
  try {
    say('Maya 付 $30（用保存的授权，不用登录）');
    const a = await pay(token, '30.00', 'Desk lamp from BrightHome (arrived broken) - Minder test');
    say('商家同意退一半：退款 $15');
    const r = await pp('POST', `/v2/payments/captures/${a.captureId}/refund`, {
      token, headers: { 'PayPal-Request-Id': uuid() },
      body: { amount: { currency_code: 'USD', value: '15.00' }, note_to_payer: 'Partial refund agreed with your Minder agent' },
    });
    if (r.ok) record('A. 商家退款（谈判后部分退款）', true, `成功：$30 里退回 $15，状态 ${r.json.status}`);
    else record('A. 商家退款（谈判后部分退款）', false, ppErr(r));
  } catch (e) {
    record('A. 商家退款（谈判后部分退款）', false, e.message);
  }

  // B) Escalation: PayPal sandbox chargeback simulator creates a real dispute record
  let disputeId;
  try {
    say('Maya 付 $25（这一单商家收钱不发货）');
    const b = await pay(token, '25.00', 'Bluetooth speaker from QuickGadgets (never shipped) - Minder test');
    report.raw.merchantIdFound = Boolean(b.merchantId);
    await sleep(4000);
    say('向 PayPal 沙盒提交"信用卡拒付"模拟，生成一条争议');
    const now = new Date();
    const iso = (d) => d.toISOString();
    const body = {
      adjacency: 'PAYPAL',
      file_layout: 'ATCK_CB',
      merchant_id: b.merchantId,
      financial_institution: { processor: 'FDMS' },
      transaction: { id_enc: b.captureId, amount: { currency_code: 'USD', value: '25.00' } },
      instrument: { instrument_type: 'CARD', card_brand: 'VISA', credit_card_transaction_id: String(Date.now()).padEnd(16, '7'), external: false },
      dispute: {
        id: null,
        stage: 'CHARGEBACK',
        response_date: iso(new Date(now.getTime() + 10 * 864e5)),
        status: '2',
        amount: { currency_code: 'USD', value: '25.00' },
        receive_date: iso(now),
        event_code: 'CHARGEBACK_INITIATED',
        money_movement_date: iso(now),
        event_type: 'DEBIT',
        chargeback_type: 'REPORTED_TO_PROCESSOR',
        processor_info: { reference_number: String(Date.now()) + '123456789', reason_code: '1330', notes: 'Minder test: merchandise not received' },
      },
    };
    const c = await pp('POST', '/v2/customer-support/process-chargeback', { token, body });
    report.raw.chargeback = { status: c.status, debugId: c.debugId, body: c.json };
    save();
    if (c.ok) {
      disputeId = c.json?.dispute_id || c.json?.id;
      record('B. 升级给 PayPal（模拟拒付生成争议）', true, `成功：争议编号 ${disputeId || '（响应里没有编号，见日志）'}`);
    } else record('B. 升级给 PayPal（模拟拒付生成争议）', false, ppErr(c));
  } catch (e) {
    record('B. 升级给 PayPal（模拟拒付生成争议）', false, e.message);
  }

  // C) Look at the dispute PayPal now holds, and try a sandbox ruling in Maya's favour
  try {
    say('读取争议列表');
    await sleep(5000);
    const list = await pp('GET', '/v1/customer/disputes?page_size=10', { token });
    const items = list.json?.items || [];
    report.raw.disputes = items.map((d) => ({ id: d.dispute_id, status: d.status, reason: d.reason, stage: d.dispute_life_cycle_stage, amount: d.dispute_amount?.value }));
    disputeId = disputeId || items[0]?.dispute_id;
    if (!disputeId) { record('C. 查看争议并让 PayPal 裁决', false, `争议列表里有 ${items.length} 条，没有可测试的争议`); return; }
    const d = await pp('GET', `/v1/customer/disputes/${disputeId}`, { token });
    const actions = (d.json?.links || []).map((l) => l.rel);
    report.raw.dispute = { id: disputeId, status: d.json?.status, stage: d.json?.dispute_life_cycle_stage, reason: d.json?.reason, actions };
    save();
    let summary = `争议 ${disputeId}：状态 ${d.json?.status}，阶段 ${d.json?.dispute_life_cycle_stage}，可做的操作：${actions.join('、') || '无'}`;
    if (actions.includes('adjudicate')) {
      const adj = await pp('POST', `/v1/customer/disputes/${disputeId}/adjudicate`, { token, body: { adjudication_outcome: 'BUYER_FAVOR' } });
      await sleep(4000);
      const after = await pp('GET', `/v1/customer/disputes/${disputeId}`, { token });
      report.raw.afterAdjudicate = { status: after.json?.status, outcome: after.json?.dispute_outcome, adjResult: adj.ok ? 'ok' : ppErr(adj) };
      summary += adj.ok ? `；模拟裁决成功，现在状态 ${after.json?.status}，结果 ${after.json?.dispute_outcome?.outcome_code || '未知'}` : `；模拟裁决失败：${ppErr(adj)}`;
    }
    record('C. 查看争议并让 PayPal 裁决', d.ok, summary);
  } catch (e) {
    record('C. 查看争议并让 PayPal 裁决', false, e.message);
  }
}

main()
  .catch((e) => record('意外错误', false, e.message))
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    save();
    console.log('\n全部测试结束。结果已保存到 logs\\验证结果3.txt。可以关掉这个窗口了。');
    setTimeout(() => process.exit(0), 300);
  });
