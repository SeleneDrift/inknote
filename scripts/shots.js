// 通过 CDP 截取应用真实界面（设置页/笔记/密码库，中英双语）。
// 前置：确保 data/ 目录不存在或已备份 —— 本脚本会写入 demo 数据！
// 用法：node scripts/shots.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9333;
const OUT = path.join(ROOT, 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  return page.webSocketDebuggerUrl;
}

let idc = 1;
function cdp(ws, method, params = {}) {
  const id = idc++;
  return new Promise((resolve, reject) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', on);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const evalJs = (ws, expr) => cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });

async function shot(ws, name) {
  const { data } = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

async function setVal(ws, sel, val) {
  await evalJs(ws, `(() => {
    const el = document.querySelector('${sel}');
    if (!el) throw new Error('not found: ${sel}');
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
  let url = null;
  for (let i = 0; i < 90; i++) {
    try { url = await targetUrl(); break; } catch { await sleep(1000); }
  }
  if (!url) { console.error('app did not start'); proc.kill(); process.exit(1); }
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r));
  await sleep(2500);

  // 1-2. 设置页（EN / 中文）
  await shot(ws, 'setup-en.png');
  await evalJs(ws, `document.getElementById('toggle-lang').click(); true`);
  await sleep(700);
  await shot(ws, 'setup-zh.png');
  await evalJs(ws, `document.getElementById('toggle-lang').click(); true`);
  await sleep(400);

  // 3. 设置主密码进入主界面
  await setVal(ws, '#lock-input', 'demo-password-2026');
  await setVal(ws, '#lock-confirm', 'demo-password-2026');
  await evalJs(ws, `document.getElementById('lock-btn').click(); true`);
  await sleep(1800);

  // 4. 示例笔记
  await evalJs(ws, `document.getElementById('new-note').click(); true`);
  await sleep(600);
  await setVal(ws, '#note-title', 'Welcome to InkNote');
  await setVal(ws, '#note-content',
    '## Your private space\n\nNotes & passwords live here — encrypted on your device with AES-256-GCM.\n\n- Markdown editing & live preview\n- Tags & full-text search\n- Auto-save');
  await sleep(1500); // 自动保存防抖 400ms

  // 5. 示例密码条目
  await evalJs(ws, `document.querySelector('[data-view="vault"]').click(); true`);
  await sleep(500);
  await evalJs(ws, `document.getElementById('new-entry').click(); true`);
  await sleep(500);
  await setVal(ws, '#entry-name', 'GitHub');
  await setVal(ws, '#entry-username', 'selenedrift');
  await evalJs(ws, `document.getElementById('gen-password').click(); true`);
  await sleep(500);
  await shot(ws, 'vault-en.png');

  // 6. 主界面 EN
  await evalJs(ws, `document.querySelector('[data-view="notes"]').click(); true`);
  await sleep(500);
  await shot(ws, 'main-en.png');

  // 7. 主界面中文
  await evalJs(ws, `document.getElementById('toggle-lang').click(); true`);
  await sleep(700);
  await shot(ws, 'main-zh.png');

  proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
