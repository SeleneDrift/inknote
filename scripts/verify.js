// 端到端验证：通过 CDP 驱动真实界面完成 设置主密码 → 写笔记 → 存密码 全流程
const http = require('http');
const fs = require('fs');
const path = require('path');

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

// 独立 CDP 连接执行表达式（重启应用后重新连接用，不依赖主流程的 ws）
async function evalOnPage(expr) {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  const value = await new Promise((res) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) res(msg.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  // 不显式 close：Node 22 undici WebSocket 在 Windows 上 close 会触发 libuv 关闭竞态断言，
  // 进程退出时连接自动释放
  return value;
}

(async () => {
  const pages = await getJson('http://127.0.0.1:9222/json');
  const page = pages.find((p) => p.type === 'page');
  if (!page) { console.log('FAIL: 未找到页面'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      if (msg.result && msg.result.exceptionDetails) pending.get(msg.id)({ error: msg.result.exceptionDetails.text });
      else pending.get(msg.id)(msg.result.result.value);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || 'unknown');
    }
  };

  const evl = (expr) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((r) => ws.onopen = r);
  await evl('document.title');
  console.log('1. 页面加载完成:', await evl('document.title'));

  // —— 首次运行：设置主密码（默认英文界面）——
  const firstRun = await evl("document.getElementById('lock-title').textContent === 'Set Master Password'");
  console.log('2. 首次运行提示设置主密码:', firstRun ? 'PASS' : 'FAIL');
  await evl("document.getElementById('sec-q-0').value='你的小学名称？'; document.getElementById('sec-a-0').value='我的小学'; 'ok'"); // 设一个密保问题供「忘记密码」测试
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-confirm').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(600);
  const entered = await evl("document.getElementById('view-main').style.display === 'flex'");
  console.log('3. 设置主密码后进入主界面:', entered ? 'PASS' : 'FAIL');

  // —— 新建笔记 ——
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('note-title').value='测试笔记'; document.getElementById('note-title').dispatchEvent(new Event('input')); document.getElementById('note-content').value='# 标题\\n这是**加粗**内容'; document.getElementById('note-content').dispatchEvent(new Event('input')); 'ok'");
  await sleep(700); // 等防抖保存
  const noteListed = await evl("document.querySelector('#notes-list-body .note-item-title').textContent === '测试笔记'");
  console.log('4. 笔记标题出现在列表:', noteListed ? 'PASS' : 'FAIL');
  const notesSaved = await evl("document.getElementById('save-status').textContent === 'Saved'");
  console.log('5. 笔记自动保存状态:', notesSaved ? 'PASS' : 'FAIL');

  // —— Markdown 预览 ——
  await evl("document.querySelector('.seg-btn[data-mode=preview]').click(); 'ok'");
  await sleep(150);
  const preview = await evl("document.getElementById('note-preview').innerHTML.includes('<strong>加粗</strong>') && document.getElementById('note-preview').innerHTML.includes('<h1>标题</h1>')");
  console.log('6. Markdown 渲染(标题+加粗):', preview ? 'PASS' : 'FAIL');

  // —— 搜索 ——
  await evl("document.getElementById('search-input').value='加粗'; document.getElementById('search-input').dispatchEvent(new Event('input')); 'ok'");
  await sleep(150);
  const searchHit = await evl("document.querySelectorAll('#notes-list-body .note-item').length === 1");
  console.log('7. 全文搜索命中:', searchHit ? 'PASS' : 'FAIL');
  await evl("document.getElementById('search-input').value=''; document.getElementById('search-input').dispatchEvent(new Event('input')); 'ok'");

  // —— 密码库 ——
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('new-entry').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('entry-name').value='Gmail'; document.getElementById('entry-name').dispatchEvent(new Event('input')); document.getElementById('entry-username').value='user@gmail.com'; document.getElementById('entry-username').dispatchEvent(new Event('input')); document.getElementById('entry-password').value='p@ssw0rd!'; document.getElementById('entry-password').dispatchEvent(new Event('input')); 'ok'");
  await sleep(700);
  const entryListed = await evl("document.querySelector('#vault-list-body .entry-item-name').textContent === 'Gmail'");
  console.log('8. 密码条目出现在列表:', entryListed ? 'PASS' : 'FAIL');

  // —— 密码生成器 ——
  await evl("document.getElementById('gen-password').click(); 'ok'");
  await sleep(400);
  const genPw = await evl("document.getElementById('entry-password').value");
  const genOk = typeof genPw === 'string' && genPw.length === 16 && /[!@#$%^&*()\-_=+?]/.test(genPw) && /[a-z]/.test(genPw) && /[A-Z]/.test(genPw) && /\d/.test(genPw);
  console.log('9. 生成 16 位强密码(含大小写/数字/符号):', genOk ? 'PASS' : 'FAIL');

  // —— 锁定与重新解锁（验证 AES 持久化）——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  const locked = await evl("document.getElementById('view-lock').style.display === 'flex'");
  console.log('10. 锁定回到解锁页:', locked ? 'PASS' : 'FAIL');
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(600);
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  const reloaded = await evl("document.querySelectorAll('#vault-list-body .entry-item').length === 1");
  console.log('11. 重解锁后密码库从磁盘恢复:', reloaded ? 'PASS' : 'FAIL');

  // —— 错误密码被拒绝 ——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  await evl("document.getElementById('lock-input').value='wrong-pass-000'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(400);
  const rejected = await evl("document.getElementById('lock-error').textContent.includes('Wrong password')");
  console.log('12. 错误主密码被拒绝并提示:', rejected ? 'PASS' : 'FAIL');

  // —— Bug 回归：标签云渲染与 chip 过滤（曾因搜索词带 # 前缀永不匹配、标签云从未渲染）——
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(600);
  await evl("document.getElementById('tag-input').value='灵感'; document.getElementById('tag-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'})); 'ok'");
  await sleep(250);
  const cloudRendered = await evl("(() => { const c = document.querySelector('#tag-cloud .tag-chip'); if (!c) return false; c.click(); return true; })()");
  await sleep(250);
  const tagFiltered = await evl("document.querySelectorAll('#notes-list-body .note-item').length === 1 && document.getElementById('search-input').value === '#灵感' && document.querySelector('#tag-cloud .tag-chip').classList.contains('active')");
  console.log('14. 添加标签后标签云渲染:', cloudRendered ? 'PASS' : 'FAIL');
  console.log('15. 标签 chip 点击过滤笔记（回归）:', tagFiltered ? 'PASS' : 'FAIL');
  const chipExists = await evl("!!document.querySelector('#tag-cloud .tag-chip')");
  if (chipExists) { await evl("document.querySelector('#tag-cloud .tag-chip').click(); 'ok'"); }
  await sleep(150);
  const tagCleared = await evl("document.getElementById('search-input').value === ''");
  console.log('16. 再次点击取消标签过滤:', tagCleared ? 'PASS' : 'FAIL');

  // —— Bug 回归：「默认」分组（曾把显示名存入过滤值导致条目消失）——
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  const groupClick = await evl("(() => { const items = document.querySelectorAll('#vault-groups-body .group-item'); if (items.length < 2) return false; items[1].click(); return true; })()");
  await sleep(250);
  const defaultShows = await evl("document.querySelectorAll('#vault-list-body .entry-item').length === 1 && document.getElementById('vault-list-title').textContent === 'Default'");
  console.log('17. 「默认」分组显示条目（回归）:', groupClick && defaultShows ? 'PASS' : 'FAIL');

  // —— 新建空笔记不立即落盘（磁盘加密后以文件字节不变判断）——
  const notesPath = path.join(__dirname, '..', 'data', 'notes.json');
  const diskBefore18 = fs.readFileSync(notesPath, 'utf8');
  await evl("document.querySelector('.nav-item[data-view=notes]').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(700);
  const diskAfter18 = fs.readFileSync(notesPath, 'utf8');
  console.log('18. 新建空笔记不落盘:', diskAfter18 === diskBefore18 ? 'PASS' : 'FAIL');

  // —— 中英文切换（默认英文；手动切中文后写入偏好）——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(600);
  const enDefault = await evl("document.querySelector('.nav-item[data-view=notes] span').textContent === 'Notes'");
  console.log('19. 默认英文界面:', enDefault ? 'PASS' : 'FAIL');
  await evl("document.getElementById('toggle-lang').click(); 'ok'");
  await sleep(300);
  const zhCheck = await evl("document.querySelector('.nav-item[data-view=notes] span').textContent === '笔记' && document.querySelector('.nav-item[data-view=vault] span').textContent === '密码库' && document.getElementById('lock-app').textContent.trim() === '锁定'");
  console.log('20. 切到中文（导航+锁定）:', zhCheck ? 'PASS' : 'FAIL');
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  const zhUnlockPage = await evl("document.getElementById('lock-title').textContent === '解锁 InkNote' && document.getElementById('lock-btn').textContent === '解锁' && document.getElementById('toggle-lang').textContent === 'EN'");
  console.log('21. 锁屏页中文文案:', zhUnlockPage ? 'PASS' : 'FAIL');
  await evl("document.getElementById('toggle-lang').click(); 'ok'");
  await sleep(200);
  const enLockPage = await evl("document.getElementById('lock-title').textContent === 'Unlock InkNote'");
  console.log('22. 切回英文锁屏页:', enLockPage ? 'PASS' : 'FAIL');
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(600);
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  await evl("document.querySelectorAll('#vault-list-body .entry-item')[0].click(); 'ok'");
  await sleep(200);
  const enDetail = await evl("document.querySelector('#detail-wrap .field label').textContent === 'Group' && document.getElementById('entry-meta').textContent.includes('Updated')");
  console.log('23. 密码库详情英文文案:', enDetail ? 'PASS' : 'FAIL');
  await evl("document.getElementById('toggle-lang').click(); 'ok'");
  await sleep(200);
  const zhDetail = await evl("document.querySelector('#detail-wrap .field label').textContent === '分组' && document.getElementById('entry-meta').textContent.includes('更新于')");
  console.log('24. 切中文后密码库详情:', zhDetail ? 'PASS' : 'FAIL');

  // —— 语言偏好持久化：手动切中文后写入 settings.json，重启仍保持中文 ——
  const settingsFile = path.join(__dirname, '..', 'data', 'settings.json');
  const langPersisted = await evl("api.settingsLoad().then(s => s.lang)");
  const persisted = langPersisted === 'zh' && JSON.parse(fs.readFileSync(settingsFile, 'utf8')).lang === 'zh';
  console.log('25. 语言偏好写入 settings.json:', persisted ? 'PASS' : 'FAIL (' + langPersisted + ')');

  // —— 本轮修复回归 ——
  // 语言切换后搜索框 placeholder 同步（当前停在中文 + 密码库视图）
  const phZh = await evl("document.getElementById('search-input').placeholder === '搜索密码库…'");
  await evl("document.querySelector('.nav-item[data-view=notes]').click(); 'ok'");
  await sleep(200);
  const phZhNotes = await evl("document.getElementById('search-input').placeholder === '搜索笔记…'");
  await evl("document.getElementById('toggle-lang').click(); 'ok'");
  await sleep(300);
  const phEn = await evl("document.getElementById('search-input').placeholder === 'Search notes…'");
  console.log('27. 切语言后搜索框 placeholder 同步:', phZh && phZhNotes && phEn ? 'PASS' : 'FAIL');

  // —— 删除最后一篇笔记后列表无残留 ——
  await evl("document.getElementById('delete-note').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('modal-ok').click(); 'ok'");
  await sleep(200);
  const noGhost = await evl("document.querySelector('#notes-list-body .note-item') === null && document.getElementById('editor-empty').style.display === 'flex'");
  console.log('28. 删除最后一篇笔记后列表无残留:', noGhost ? 'PASS' : 'FAIL');

  // —— 空笔记不被连带保存 + 笔记落盘为密文（磁盘不得含明文）——
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('note-title').value='第二篇'; document.getElementById('note-title').dispatchEvent(new Event('input')); document.getElementById('note-content').value='内容B'; document.getElementById('note-content').dispatchEvent(new Event('input')); 'ok'");
  await sleep(700);
  const disk29 = fs.readFileSync(notesPath, 'utf8');
  const onDisk = JSON.parse(disk29);
  const encOk = !disk29.includes('第二篇') && !disk29.includes('内容B') && !Array.isArray(onDisk) && onDisk.v === 1;
  console.log('29. 笔记加密落盘（磁盘无明文）:', encOk ? 'PASS' : 'FAIL');

  // —— 锁定前冲刷防抖中的编辑（重新解锁后 UI 验证）——
  await evl("document.getElementById('note-content').value='内容B-追加'; document.getElementById('note-content').dispatchEvent(new Event('input')); document.getElementById('lock-app').click(); 'ok'");
  await sleep(400);
  await evl("document.getElementById('lock-input').value='test-pass-123'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(700);
  const flushed = await evl("document.getElementById('note-content').value.includes('内容B-追加')");
  console.log('30. 锁定前冲刷防抖中的编辑:', flushed ? 'PASS' : 'FAIL');

  // —— 在密码库视图点标签 chip，过滤不丢失 ——
  await evl("document.getElementById('tag-input').value='回归'; document.getElementById('tag-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'})); 'ok'");
  await sleep(300);
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  await evl("document.querySelector('#tag-cloud .tag-chip').click(); 'ok'");
  await sleep(300);
  const chipOk = await evl("document.querySelector('#main-nav .nav-item.active').dataset.view === 'notes' && document.getElementById('search-input').value === '#回归' && document.querySelectorAll('#notes-list-body .note-item').length === 1");
  console.log('31. 密码库视图点标签 chip 过滤不丢失:', chipOk ? 'PASS' : 'FAIL');

  // —— 移除标签后列表与标签云同步 ——
  await evl("document.querySelector('.tag-pill .tag-remove').click(); 'ok'");
  await sleep(300);
  const rmOk = await evl("document.querySelector('#notes-list-body .note-item') === null && document.querySelector('#tag-cloud .tag-chip') === null");
  console.log('32. 移除标签后列表与标签云同步:', rmOk ? 'PASS' : 'FAIL');

  // —— 忘记主密码：密保重置全流程（错误答案被拒 → 正确答案重置，数据保留）——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  await evl("document.getElementById('toggle-lang').click(); 'ok'"); // 27 段切回了英文，这里切回中文以便后续断言
  await sleep(200);
  await evl("document.getElementById('lock-input').value='wrong-password'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(400);
  const wrongPwdUi = await evl("document.getElementById('lock-error').textContent.includes('主密码错误') && document.getElementById('forgot-wrap').style.display !== 'none' && document.getElementById('vault-reset').style.display === 'none'");
  console.log('33. 主密码错误(有密保)仅显示忘记密码入口:', wrongPwdUi ? 'PASS' : 'FAIL');
  await evl("document.getElementById('forgot-btn').click(); 'ok'");
  await sleep(200);
  const secPanel = await evl("document.getElementById('sec-reset').style.display !== 'none' && document.getElementById('lock-main').style.display === 'none' && document.getElementById('sec-select').options.length === 1");
  console.log('34. 忘记密码面板显示密保问题:', secPanel ? 'PASS' : 'FAIL');
  await evl("document.getElementById('sec-answer').value='错误答案'; document.getElementById('sec-new').value='new-pass-456'; document.getElementById('sec-new-confirm').value='new-pass-456'; document.getElementById('sec-reset-btn').click(); 'ok'");
  await sleep(500);
  const wrongAns = await evl("document.getElementById('sec-error').textContent.includes('密保答案错误') && document.getElementById('vault-reset').style.display !== 'none'");
  console.log('35. 密保答案错误被拒绝(并给出重置入口):', wrongAns ? 'PASS' : 'FAIL');
  await evl("document.getElementById('sec-answer').value='我的小学'; document.getElementById('sec-new').value='new-pass-456'; document.getElementById('sec-new-confirm').value='new-pass-456'; document.getElementById('sec-reset-btn').click(); 'ok'");
  await sleep(2000); // 密保重置含 2 次 scrypt + 加解密 + 笔记加载，需更长等待
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  const resetKept = await evl("document.getElementById('view-main').style.display === 'flex' && document.querySelectorAll('#notes-list-body .note-item').length === 1 && document.querySelectorAll('#vault-list-body .entry-item').length === 1");
  console.log('36. 密保重置主密码成功且数据保留:', resetKept ? 'PASS' : 'FAIL');

  // —— 密码库损坏：只提供重置密码库（密保也解不开）——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'vault.json'), 'not-json-at-all');
  await evl("document.getElementById('lock-input').value='new-pass-456'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(400);
  const corruptUi = await evl("document.getElementById('lock-error').textContent.includes('数据无法解密') && document.getElementById('vault-reset').style.display !== 'none' && document.getElementById('forgot-wrap').style.display === 'none'");
  console.log('37. 密码库损坏时仅提供重置密码库:', corruptUi ? 'PASS' : 'FAIL');
  await evl("document.getElementById('vault-reset').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('modal-ok').click(); 'ok'");
  await sleep(400);
  const resetUi = await evl("document.getElementById('lock-title').textContent === '设置主密码'");
  console.log('38. 重置密码库后回到设置主密码:', resetUi ? 'PASS' : 'FAIL');
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-confirm').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(700);
  const freshAll = await evl("document.getElementById('view-main').style.display === 'flex' && document.querySelectorAll('#vault-list-body .entry-item').length === 0 && document.querySelectorAll('#notes-list-body .note-item').length === 0");
  console.log('39. 重置后以新主密码进入空密码库与空笔记:', freshAll ? 'PASS' : 'FAIL');

  console.log('40. 渲染进程未捕获异常:', errors.length === 0 ? 'PASS' : 'FAIL ' + errors.join(' | '));

  // —— Bug 回归：预览内相对链接不导航（曾可把整窗带离应用变成错误页）——
  await evl("document.querySelector('.nav-item[data-view=notes]').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('note-title').value='链接笔记'; document.getElementById('note-title').dispatchEvent(new Event('input')); document.getElementById('note-content').value='[相对链接](./local-file.md) 与 [外链](https://example.com)'; document.getElementById('note-content').dispatchEvent(new Event('input')); 'ok'");
  await evl("document.querySelector('.seg-btn[data-mode=preview]').click(); 'ok'");
  await sleep(150);
  await evl("document.querySelector('#note-preview a').click(); 'ok'");
  await sleep(400);
  const noNav = await evl("location.href.endsWith('renderer/index.html') && document.getElementById('lock-app') !== null");
  console.log('43. 预览内相对链接不导航（回归）:', noNav ? 'PASS' : 'FAIL');
  await evl("document.querySelector('.seg-btn[data-mode=edit]').click(); 'ok'");
  await evl("document.getElementById('delete-note').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('modal-ok').click(); 'ok'");
  await sleep(300);

  // —— Bug 回归：锁屏页切换语言不清空已输入的密码 ——
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  await evl("document.getElementById('lock-input').value='some-typed-password'; 'ok'");
  await evl("document.getElementById('toggle-lang').click(); 'ok'");
  await sleep(300);
  const langKeptInput = await evl("document.getElementById('lock-input').value === 'some-typed-password' && document.getElementById('lock-title').textContent === 'Unlock InkNote'");
  console.log('44. 锁屏切语言保留已输入密码（回归）:', langKeptInput ? 'PASS' : 'FAIL');
  await evl("document.getElementById('toggle-lang').click(); 'ok'"); // 切回中文，保持后续断言语言一致
  await sleep(300);
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(700);

  // —— 解锁后管理密保问题（侧栏入口，保存需验证主密码）——
  await evl("document.getElementById('sec-manage-btn').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('sec-manage-add').click(); 'ok'");
  await sleep(150);
  await evl("(() => { const inputs = document.querySelectorAll('#sec-manage-list input'); inputs[0].value='后续添加的问题'; inputs[0].dispatchEvent(new Event('input')); inputs[1].value='后续答案'; inputs[1].dispatchEvent(new Event('input')); return 'ok'; })()");
  await evl("document.getElementById('sec-manage-pw').value='wrong-confirm-pw'; document.getElementById('sec-manage-save').click(); 'ok'");
  await sleep(400);
  const secPwWrong = await evl("document.getElementById('sec-manage-error').textContent.includes('主密码错误') && document.getElementById('sec-manage-mask').style.display !== 'none'");
  console.log('45. 修改密保需正确主密码:', secPwWrong ? 'PASS' : 'FAIL');
  await evl("document.getElementById('sec-manage-pw').value='final-pass-789'; document.getElementById('sec-manage-save').click(); 'ok'");
  await sleep(500);
  const secSaved = await evl("document.getElementById('sec-manage-mask').style.display === 'none'");
  console.log('46. 解锁后添加密保问题保存:', secSaved ? 'PASS' : 'FAIL');
  // 新问题出现在「忘记密码」列表中
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  await evl("document.getElementById('lock-input').value='not-the-password'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(400);
  const forgotShown = await evl("document.getElementById('forgot-wrap').style.display !== 'none'");
  await evl("document.getElementById('forgot-btn').click(); 'ok'");
  await sleep(200);
  const newQListed = await evl("document.getElementById('sec-select').options.length === 1 && document.getElementById('sec-select').options[0].textContent === '后续添加的问题'");
  console.log('47. 新密保问题出现在忘记密码列表:', forgotShown && newQListed ? 'PASS' : 'FAIL');
  await evl("document.getElementById('sec-back').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(700);

  // —— 跨设备迁移：导出 → 空机导入 → 合并（文件对话框无法自动化，备份 IPC 走显式路径）——
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('note-title').value='迁移笔记'; document.getElementById('note-title').dispatchEvent(new Event('input')); document.getElementById('note-content').value='迁移内容'; document.getElementById('note-content').dispatchEvent(new Event('input')); 'ok'");
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('new-entry').click(); 'ok'");
  await sleep(150);
  await evl("document.getElementById('entry-name').value='迁移条目'; document.getElementById('entry-name').dispatchEvent(new Event('input')); 'ok'");
  await sleep(700);
  const exported = await evl("api.backupExport('final-pass-789', 'data/test-backup.ink').then(r => r.ok)");
  const disk48 = exported && fs.existsSync('data/test-backup.ink')
    && !fs.readFileSync('data/test-backup.ink', 'utf8').includes('迁移内容')
    && JSON.parse(fs.readFileSync('data/test-backup.ink', 'utf8')).kind === 'inknote-backup';
  console.log('48. 导出加密备份（磁盘无明文）:', disk48 ? 'PASS' : 'FAIL');

  // 非备份文件（结构不符）被拒
  fs.writeFileSync('data/bad.ink', JSON.stringify({ v: 1, kind: 'something-else' }));
  const notBackup = await evl("api.backupPick('data/bad.ink').then(r => !r.ok && r.error === 'not-backup')");
  console.log('49. 非备份文件被拒:', notBackup ? 'PASS' : 'FAIL');

  // 清空本机（锁定→损坏→重置密码库），回到首次设置页
  await evl("document.getElementById('lock-app').click(); 'ok'");
  await sleep(300);
  fs.writeFileSync('data/vault.json', 'not-json-at-all');
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(400);
  await evl("document.getElementById('vault-reset').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('modal-ok').click(); 'ok'");
  await sleep(400);
  const freshPage = await evl("document.getElementById('lock-title').textContent === '设置主密码' && document.getElementById('backup-import-wrap').style.display !== 'none'");
  if (!freshPage) console.log('(注意：未回到首次设置页，后续迁移断言可能失败)');

  // 备份密码错误被拒
  const wrongPwdImport = await evl("api.backupRestore('wrong-pwd-000', 'data/test-backup.ink').then(r => !r.ok && r.error === 'wrong-password')");
  console.log('50. 备份密码错误被拒:', wrongPwdImport ? 'PASS' : 'FAIL');

  // 正确导入：沿用原主密码，重启界面后数据还原
  const restored = await evl("api.backupRestore('final-pass-789', 'data/test-backup.ink').then(r => r.ok)");
  await evl("setTimeout(() => location.reload(), 0); 'ok'");
  await sleep(3000);
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(800);
  const noteBack = await evl("document.querySelector('#notes-list-body .note-item-title').textContent === '迁移笔记'");
  await evl("document.querySelector('.nav-item[data-view=vault]').click(); 'ok'");
  await sleep(200);
  const entryBack = await evl("document.querySelector('#vault-list-body .entry-item-name').textContent === '迁移条目'");
  console.log('51. 空机导入还原笔记与条目:', restored && noteBack && entryBack ? 'PASS' : 'FAIL');

  // 合并导入：本地删除的笔记从备份合并回来（同时演示“删除不传播”语义）
  await evl("document.querySelector('.nav-item[data-view=notes]').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('delete-note').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('modal-ok').click(); 'ok'");
  await sleep(600);
  const mergedAdded = await evl("api.backupMerge('final-pass-789', 'data/test-backup.ink').then(r => r.ok ? r.summary.notesAdded : -1)");
  await evl("setTimeout(() => location.reload(), 0); 'ok'");
  await sleep(3000);
  await evl("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
  await sleep(800);
  const mergedBack = await evl("(() => { const t = document.querySelector('#notes-list-body .note-item-title'); return t !== null && t.textContent === '迁移笔记'; })()");
  console.log('52. 导入合并（本地已删笔记合并回来）:', mergedAdded === 1 && mergedBack ? 'PASS' : 'FAIL');

  // —— 关窗前冲刷（走用户真实的关窗路径：标题栏 X 按钮；关窗断开 CDP，重启应用验证落盘）——
  await evl("document.querySelector('.nav-item[data-view=notes]').click(); 'ok'");
  await sleep(200);
  await evl("document.getElementById('new-note').click(); 'ok'");
  await sleep(100);
  await evl("document.getElementById('note-title').value='关窗测试'; document.getElementById('note-title').dispatchEvent(new Event('input')); document.getElementById('note-content').value='关窗前最后编辑'; document.getElementById('note-content').dispatchEvent(new Event('input')); 'ok'");
  await sleep(100); // 未到 400ms 防抖，验证关窗冲刷
  await evl('window.api.close(); 0');
  await sleep(1500);
  const { spawn } = require('child_process');
  const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, ['--remote-debugging-port=9222', '.'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  let booted = false;
  for (let i = 0; i < 20 && !booted; i++) {
    await sleep(500);
    try { const p = await getJson('http://127.0.0.1:9222/json'); booted = p.some((x) => x.type === 'page'); } catch {}
  }
  let closeFlush = false;
  let langKept = false;
  if (booted) {
    try {
      await sleep(2500); // 冷启动渲染可能较慢，等 initLock 完成
      langKept = (await evalOnPage("(document.getElementById('lock-title')||{}).textContent")) === '解锁 InkNote'; // 25 段写入的 zh 偏好，重启后应保持
      await evalOnPage("document.getElementById('lock-input').value='final-pass-789'; document.getElementById('lock-btn').click(); 'ok'");
      await sleep(800);
      closeFlush = await evalOnPage("document.getElementById('note-content').value.includes('关窗前最后编辑')");
    } catch {}
  }
  console.log('41. 关窗前冲刷最后编辑（重启验证）:', closeFlush ? 'PASS' : 'FAIL');
  console.log('42. 手动切中文后重启保持:', langKept ? 'PASS' : 'FAIL');
  try { child.kill(); } catch {}
  // 进程即将退出，无需显式关闭 WebSocket（显式关闭在 Windows 上会触发 undici 关闭竞态断言）
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
