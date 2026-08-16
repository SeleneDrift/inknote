/* 灵感簿 · 渲染进程逻辑 */
(() => {
  const api = window.api;
  const $ = (id) => document.getElementById(id);

  /* ---------- 工具 ---------- */
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return T('today') + ' ' + hm;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return T('yesterday') + ' ' + hm;
    const sameYear = d.getFullYear() === now.getFullYear();
    if (getLang() === 'zh') {
      return sameYear
        ? (d.getMonth() + 1) + '月' + d.getDate() + '日'
        : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    return d.toLocaleDateString('en-US', sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // 可冲刷的防抖保存：schedule 后延时落盘；flush 立即落盘并返回是否成功（锁定/关窗前用）。
  // 保存失败时保留脏标记，下次 schedule/flush 会连着这批编辑一起重试
  function makeSaver(perform) {
    let timer = null;
    let pending = false;
    const flush = async () => {
      clearTimeout(timer);
      if (!pending) return true;
      pending = false;
      const ok = await perform();
      if (!ok) pending = true;
      return ok;
    };
    return {
      schedule() {
        pending = true;
        clearTimeout(timer);
        timer = setTimeout(flush, 400);
      },
      flush,
      cancel() {
        pending = false;
        clearTimeout(timer);
      },
    };
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function confirmModal({ title, text, okText = T('delete'), danger = true, onOk }) {
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    const ok = $('modal-ok');
    ok.textContent = okText;
    ok.style.background = danger ? 'var(--danger)' : '';
    ok.onclick = () => { hideModal(); onOk(); };
    $('modal-cancel').onclick = hideModal;
    $('modal-mask').style.display = 'grid';
  }
  function hideModal() { $('modal-mask').style.display = 'none'; }

  // 通用密码确认弹窗（导出/导入备份用）：resolve(密码) 或 resolve(null) 取消
  let promptResolve = null;
  function promptPassword({ title, sub = '', okText }) {
    return new Promise((resolve) => {
      promptResolve = resolve;
      $('prompt-title').textContent = title;
      $('prompt-sub').textContent = sub;
      $('prompt-sub').style.display = sub ? '' : 'none';
      $('prompt-input').value = '';
      $('prompt-error').textContent = '';
      $('prompt-ok').textContent = okText || T('confirm');
      $('prompt-mask').style.display = 'grid';
      $('prompt-input').focus();
    });
  }
  function closePrompt(value) {
    $('prompt-mask').style.display = 'none';
    if (promptResolve) { promptResolve(value); promptResolve = null; }
  }

  const renderMarkdown = (md) => DOMPurify.sanitize(marked.parse(md || ''));

  function generatePassword(len = 16) {
    const sets = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%^&*()-_=+?'];
    const all = sets.join('');
    // 拒绝采样：丢弃落在最后一个完整周期内的值，消除 r % n 的取模偏差
    const randBelow = (n) => {
      const limit = Math.floor(0x100000000 / n) * n;
      const buf = new Uint32Array(1);
      for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % n;
      }
    };
    const chars = Array.from({ length: len }, () => all[randBelow(all.length)]);
    // 保证每类至少一个，再整体打乱，避免「前 4 位恰好是四类字符」的结构泄露
    for (let i = 0; i < sets.length; i++) chars[i] = sets[i][randBelow(sets[i].length)];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randBelow(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  /* ---------- 全局状态 ---------- */
  const state = {
    firstRun: false,
    security: [],        // 密保问题文本（解锁页「忘记密码」入口用）
    unlocked: false,
    view: 'notes',            // notes | vault
    notes: [],
    noteId: null,
    vault: [],
    vaultId: null,
    group: '全部',
    search: '',
    tagFilter: null,
  };

  /* ---------- 解锁 / 设置 ---------- */

  // 首次设置时的密保问题行（可选，最多 3 行）
  let secCount = 0;
  function renderSecRows() {
    const list = $('sec-list');
    // 重建前留存已输入的问题/答案（语言切换等纯刷新场景不应丢用户输入）
    const prev = [...list.querySelectorAll('.sec-row input')].map((i) => i.value);
    list.innerHTML = '';
    for (let i = 0; i < secCount; i++) {
      const row = document.createElement('div');
      row.className = 'sec-row';
      row.innerHTML = `
        <div class="sec-row-head">
          <span class="sec-row-label">${T('secQuestion')} ${i + 1}</span>
          <button class="text-btn sec-remove" title="${T('secRemove')}">✕</button>
        </div>
        <input id="sec-q-${i}" class="text-input" type="text" placeholder="${T('secQPh')}" spellcheck="false">
        <input id="sec-a-${i}" class="text-input" type="text" placeholder="${T('secAPh')}" spellcheck="false">
      `;
      row.querySelector('.sec-remove').onclick = () => { secCount--; renderSecRows(); };
      list.appendChild(row);
      $('sec-q-' + i).value = prev[i * 2] ?? '';
      $('sec-a-' + i).value = prev[i * 2 + 1] ?? '';
    }
  }
  function collectSecurity() {
    const out = [];
    for (let i = 0; i < secCount; i++) {
      const q = $('sec-q-' + i).value.trim();
      const a = $('sec-a-' + i).value.trim();
      if (q && a) out.push({ q, a });
    }
    return out;
  }

  async function initLock() {
    const { firstRun, security } = await api.init();
    state.firstRun = firstRun;
    state.security = security;
    $('lock-title').textContent = firstRun ? T('lockTitleSetup') : T('lockTitleUnlock');
    $('lock-subtitle').textContent = firstRun ? T('lockSubtitleSetup') : T('lockSubtitleUnlock');
    $('lock-confirm').style.display = firstRun ? '' : 'none';
    $('lock-hint').style.display = firstRun ? '' : 'none';
    $('lock-btn').textContent = firstRun ? T('lockBtnStart') : T('lockBtnUnlock');
    $('lock-main').style.display = '';
    $('sec-reset').style.display = 'none';
    $('forgot-wrap').style.display = 'none';
    $('security-setup').style.display = firstRun ? '' : 'none';
    if (firstRun) { secCount = 1; renderSecRows(); } // 默认给一行，可添加至 3 行
    else { secCount = 0; $('sec-list').innerHTML = ''; }
    $('lock-error').textContent = '';
    $('sec-error').textContent = '';
    $('vault-reset').style.display = 'none';
    $('vault-reset-hint').style.display = 'none';
    $('backup-import-wrap').style.display = firstRun ? '' : 'none'; // 空机迁移入口只在首次设置页显示
    $('lock-input').value = '';
    $('lock-confirm').value = '';
    $('lock-input').focus();
  }

  // 锁屏页只刷新文案（语言切换用）：不重置输入框、不改变面板显隐
  function refreshLockTexts() {
    $('lock-title').textContent = state.firstRun ? T('lockTitleSetup') : T('lockTitleUnlock');
    $('lock-subtitle').textContent = state.firstRun ? T('lockSubtitleSetup') : T('lockSubtitleUnlock');
    $('lock-btn').textContent = state.firstRun ? T('lockBtnStart') : T('lockBtnUnlock');
    if (state.firstRun) renderSecRows(); // renderSecRows 会保留已输入的问题/答案
  }

  async function handleLockSubmit() {
    const mp = $('lock-input').value;
    const err = $('lock-error');
    err.textContent = '';
    if (!mp) { err.textContent = T('errEmptyPwd'); return; }
    if (state.firstRun) {
      if (mp.length < 6) { err.textContent = T('errTooShort'); return; }
      const c = $('lock-confirm').value;
      if (mp !== c) { err.textContent = T('errMismatch'); return; }
      try {
        await api.vaultSetup(mp, collectSecurity());
        toast(T('welcome'));
        enterMain([]);
      } catch (e) { err.textContent = e.message || T('errInitFail'); }
    } else {
      const res = await api.vaultUnlock(mp);
      if (res.ok) enterMain(res.entries);
      else {
        err.textContent = res.error === 'wrong-password' ? T('errWrongPwd') : T('errCorrupt');
        // 有密保问题：只给「忘记密码」入口；无密保或数据损坏才提供破坏性的「重置密码库」，
        // 避免普通密码输错就把删库入口摆出来（密保答案也答错时再给出，见 submitSecReset）
        const canRecover = res.error === 'wrong-password' && state.security.length > 0;
        $('forgot-wrap').style.display = canRecover ? '' : 'none';
        $('vault-reset').style.display = canRecover ? 'none' : '';
        $('vault-reset-hint').style.display = canRecover ? 'none' : '';
      }
    }
    $('lock-input').select();
  }

  /* ---------- 忘记密码：密保重置 ---------- */
  function openSecReset() {
    $('lock-main').style.display = 'none';
    $('sec-reset').style.display = '';
    $('forgot-wrap').style.display = 'none';
    $('vault-reset').style.display = 'none';
    $('vault-reset-hint').style.display = 'none';
    $('lock-error').textContent = '';
    $('sec-select').innerHTML = state.security
      .map((q, i) => `<option value="${i}">${escapeHtml(q)}</option>`).join('');
    $('sec-answer').value = '';
    $('sec-new').value = '';
    $('sec-new-confirm').value = '';
    $('sec-error').textContent = '';
    $('sec-answer').focus();
  }
  function closeSecReset() {
    $('sec-reset').style.display = 'none';
    $('lock-main').style.display = '';
    $('lock-error').textContent = '';
    $('vault-reset').style.display = 'none';
    $('vault-reset-hint').style.display = 'none';
    $('lock-input').select();
  }
  async function submitSecReset() {
    const err = $('sec-error');
    err.textContent = '';
    const answer = $('sec-answer').value.trim();
    const np = $('sec-new').value;
    const nc = $('sec-new-confirm').value;
    if (!answer) { err.textContent = T('errSecEmpty'); return; }
    if (np.length < 6) { err.textContent = T('errSecShort'); return; }
    if (np !== nc) { err.textContent = T('errSecMismatch'); return; }
    const res = await api.resetPassword(Number($('sec-select').value), answer, np);
    if (res.ok) {
      toast(T('pwdResetDone'));
      enterMain(res.entries);
    } else if (res.error === 'wrong-answer') {
      err.textContent = T('errSecAnswer');
      // 密保答案也答不上：此时才给出「重置密码库」这个最后手段
      $('vault-reset').style.display = '';
      $('vault-reset-hint').style.display = '';
    } else {
      err.textContent = T('errCorrupt');
      $('vault-reset').style.display = '';
      $('vault-reset-hint').style.display = '';
    }
  }

  /* ---------- 密保问题管理（解锁后） ---------- */
  // 现有条目 { existing: true, q, idx }（idx 为 vault 中的原始下标），新增条目 { q, a }
  let secItems = [];

  function openSecManage() {
    secItems = state.security.map((q, idx) => ({ existing: true, q, idx }));
    $('sec-manage-pw').value = '';
    $('sec-manage-error').textContent = '';
    renderSecManage();
    $('sec-manage-mask').style.display = 'grid';
    $('sec-manage-pw').focus();
  }

  function renderSecManage(focusNew) {
    const list = $('sec-manage-list');
    list.innerHTML = '';
    secItems.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'sec-row sec-manage-row';
      if (item.existing) {
        row.innerHTML = `
          <div class="sec-row-head">
            <span class="sec-manage-q">${escapeHtml(item.q)}</span>
            <button class="text-btn sec-remove" title="${T('secRemove')}">✕</button>
          </div>
          <div class="sec-manage-note">${T('secAnswerKept')}</div>`;
      } else {
        row.innerHTML = `
          <div class="sec-row-head">
            <span class="sec-row-label">${T('secNewRow')}</span>
            <button class="text-btn sec-remove" title="${T('secRemove')}">✕</button>
          </div>
          <input class="text-input" type="text" placeholder="${T('secQPh')}" spellcheck="false">
          <input class="text-input" type="text" placeholder="${T('secAPh')}" spellcheck="false">`;
        const [qInput, aInput] = row.querySelectorAll('input');
        qInput.value = item.q;
        aInput.value = item.a;
        qInput.oninput = (e) => { item.q = e.target.value; };
        aInput.oninput = (e) => { item.a = e.target.value; };
      }
      row.querySelector('.sec-remove').onclick = () => { secItems.splice(i, 1); renderSecManage(); };
      list.appendChild(row);
    });
    $('sec-manage-add').style.display = secItems.length < 3 ? '' : 'none';
    if (focusNew) {
      const inputs = list.querySelectorAll('input');
      if (inputs.length >= 2) inputs[inputs.length - 2].focus();
    }
  }

  async function saveSecManage() {
    const err = $('sec-manage-error');
    err.textContent = '';
    const pw = $('sec-manage-pw').value;
    if (!pw) { err.textContent = T('errSecEmptyPwd'); return; }
    const add = [];
    for (const item of secItems) {
      if (item.existing) continue;
      const q = item.q.trim();
      const a = item.a.trim();
      if (!q && !a) continue; // 完全空白的新增行忽略
      if (!q || !a) { err.textContent = T('errSecIncomplete'); return; }
      if (q.length > 100 || a.length > 200) { err.textContent = T('errSecTooLong'); return; }
      add.push({ q, a });
    }
    const keepIndices = secItems.filter((x) => x.existing).map((x) => x.idx);
    const apply = () => doSecUpdate(pw, keepIndices, add);
    // 从有到无等于放弃唯一的找回通道，多确认一次
    if (state.security.length > 0 && keepIndices.length + add.length === 0) {
      confirmModal({
        title: T('secManageTitle'),
        text: T('secRemoveAllConfirm'),
        okText: T('save'),
        onOk: apply,
      });
      return;
    }
    await apply();
  }

  async function doSecUpdate(pw, keepIndices, add) {
    const err = $('sec-manage-error');
    const res = await api.securityUpdate(pw, keepIndices, add);
    if (res.ok) {
      state.security = res.security;
      $('sec-manage-mask').style.display = 'none';
      toast(T('secUpdated'));
    } else if (res.error === 'wrong-password') {
      err.textContent = T('errWrongPwd');
    } else {
      err.textContent = T('errCorrupt');
    }
  }

  /* ---------- 备份 / 跨设备迁移 ---------- */
  // 导出（需解锁）：确认主密码 → 冲刷防抖 → 主进程生成 .ink 备份文件
  async function exportBackup() {
    const pwd = await promptPassword({ title: T('backupExportTitle'), sub: T('backupExportSub') });
    if (pwd == null) return;
    const flushed = (await notesSaver.flush()) && (await vaultSaver.flush());
    if (!flushed) { toast(T('saveFailed')); return; }
    const res = await api.backupExport(pwd);
    if (res.ok) toast(T('backupExported'));
    else if (res.error === 'wrong-password') toast(T('errWrongPwd'));
    else if (res.error !== 'canceled') toast(T('saveFailed'));
  }

  // 合并导入（需解锁）：只搬数据不动本机钥匙；同 id 较新者胜
  async function importBackup() {
    const flushed = (await notesSaver.flush()) && (await vaultSaver.flush());
    if (!flushed) { toast(T('saveFailed')); return; }
    const pick = await api.backupPick();
    if (!pick.ok) {
      if (pick.error === 'not-backup') toast(T('errNotBackup'));
      else if (pick.error !== 'canceled') toast(T('errCorrupt'));
      return;
    }
    const pwd = await promptPassword({ title: T('backupImportTitle'), sub: T('backupImportMergeSub') });
    if (pwd == null) return;
    const res = await api.backupMerge(pwd, pick.path);
    if (!res.ok) {
      if (res.error === 'wrong-password') toast(T('errWrongPwd'));
      else if (res.error === 'not-backup') toast(T('errNotBackup'));
      else toast(T('errCorrupt'));
      return;
    }
    state.notes = res.notes;
    state.vault = res.entries;
    renderNotesList();
    renderGroups();
    renderVaultList();
    // 尽量保持当前选中项；已被合并掉（不存在）的选中项回退到空态
    if (state.noteId && state.notes.some((n) => n.id === state.noteId)) openNote(state.noteId);
    else openFirstNote();
    if (state.vaultId && !state.vault.some((e) => e.id === state.vaultId)) {
      state.vaultId = null;
      $('vault-empty').style.display = 'flex';
      $('detail-wrap').style.display = 'none';
    }
    toast(T('backupMerged', {
      n1: res.summary.notesAdded, n2: res.summary.notesUpdated,
      e1: res.summary.entriesAdded, e2: res.summary.entriesUpdated,
    }));
  }

  // 空机导入（锁屏首次设置页）：备份的钥匙层与数据整体落地，沿用原主密码
  async function importBackupOnLock() {
    const pick = await api.backupPick();
    if (!pick.ok) {
      if (pick.error === 'not-backup') toast(T('errNotBackup'));
      else if (pick.error !== 'canceled') toast(T('errCorrupt'));
      return;
    }
    const pwd = await promptPassword({ title: T('backupImportTitle'), sub: T('backupImportRestoreSub') });
    if (pwd == null) return;
    const res = await api.backupRestore(pwd, pick.path);
    if (res.ok) {
      toast(T('backupRestored'));
      initLock(); // vault.json 已就位，回到普通解锁页
    } else if (res.error === 'wrong-password') toast(T('errWrongPwd'));
    else if (res.error === 'vault-exists') toast(T('errVaultExists'));
    else if (res.error === 'not-backup') toast(T('errNotBackup'));
    else toast(T('errCorrupt'));
  }

  async function lockApp() {
    // 锁定前冲刷挂起的自动保存，避免最后 400ms 内的编辑丢失
    const ok = (await notesSaver.flush()) && (await vaultSaver.flush());
    if (!ok) { toast(T('saveFailed')); return; }
    vaultSaver.cancel();
    await api.vaultLock();
    state.unlocked = false;
    state.vault = [];
    state.vaultId = null;
    state.notes = [];
    state.noteId = null;
    state.search = '';
    state.group = '全部';    // 残留的分组/标签过滤不带入下次会话
    state.tagFilter = null;
    $('search-input').value = '';
    $('view-main').style.display = 'none';
    $('view-lock').style.display = 'flex';
    initLock();
  }

  /* ---------- 进入主界面 ---------- */
  async function enterMain(vaultEntries) {
    state.unlocked = true;
    state.vault = vaultEntries;
    state.notes = await api.notesLoad();
    state.group = '全部'; // 上次会话残留的分组过滤不应带进新会话
    $('view-lock').style.display = 'none';
    $('view-main').style.display = 'flex';
    state.view = 'notes';
    switchView('notes');
    renderNotesList();
    openFirstNote();
  }

  function switchView(v) {
    state.view = v;
    document.querySelectorAll('#main-nav .nav-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === v));
    $('notes-view').style.display = v === 'notes' ? 'flex' : 'none';
    $('vault-view').style.display = v === 'vault' ? 'flex' : 'none';
    $('search-input').placeholder = v === 'notes' ? T('searchNotes') : T('searchVault');
    if (state.tagFilter) clearTagFilter();
    renderGroups();
    renderVaultList();
  }

  /* ================= 笔记 ================= */
  const notesSaver = makeSaver(async () => {
    const status = $('save-status');
    status.textContent = T('saving');
    status.className = 'save-status saving';
    try {
      // 落盘时过滤空白笔记，避免误点「＋」产生的空笔记被后续保存连带写入
      const meaningful = state.notes.filter((n) => n.title.trim() || n.content.trim() || n.tags.length);
      await api.notesSave(meaningful);
      status.textContent = T('saved');
      status.className = 'save-status saved';
      return true;
    } catch {
      status.textContent = T('saveFailed');
      status.className = 'save-status error';
      return false;
    }
  });
  const saveNotes = () => notesSaver.schedule();

  function noteMatches(n) {
    // 标签过滤仅在搜索框恰好是「#标签」时生效；继续输入其它字符则转普通全文搜索
    if (state.tagFilter && state.search === '#' + state.tagFilter) return n.tags.includes(state.tagFilter);
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase().includes(q);
  }

  function visibleNotes() {
    return state.notes.filter(noteMatches)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderNotesList() {
    const body = $('notes-list-body');
    const keepScroll = body.scrollTop; // 全量重建会丢滚动位置，重建后恢复
    const list = visibleNotes();
    renderTagCloud(); // 列表刷新时同步侧栏标签云（含空结果与首次进入）
    if (!list.length) {
      body.innerHTML = `<div class="empty-hint">${state.search ? T('noNotesMatch') : T('noNotes')}</div>`;
      body.scrollTop = keepScroll;
      return;
    }
    body.innerHTML = '';
    for (const n of list) {
      const el = document.createElement('div');
      el.className = 'note-item' + (n.id === state.noteId ? ' active' : '');
      el.dataset.id = n.id;
      const title = n.title || T('untitled');
      el.innerHTML = `
        <div class="note-item-title ${n.title ? '' : 'untitled'}">${escapeHtml(title)}</div>
        <div class="note-item-meta"><span>${fmtDate(n.updatedAt)}</span></div>
        ${n.content ? `<div class="note-item-snippet">${escapeHtml(snippetOf(n.content))}</div>` : ''}
        ${n.tags.length ? `<div class="note-item-tags">${n.tags.map((t) => `<span class="note-item-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      `;
      el.onclick = () => openNote(n.id);
      body.appendChild(el);
    }
    body.scrollTop = keepScroll;
  }

  function snippetOf(content) {
    const text = content.replace(/^#{1,6}\s*/gm, '').replace(/[`*>_~#|-]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openNote(id) {
    const n = state.notes.find((x) => x.id === id);
    if (!n) return;
    state.noteId = id;
    renderNotesList();
    $('editor-empty').style.display = 'none';
    $('editor-wrap').style.display = 'flex';
    $('note-title').value = n.title;
    $('note-content').value = n.content;
    renderTags(n.tags);
    $('save-status').textContent = T('saved');
    $('save-status').className = 'save-status saved';
    setEditorMode('edit');
  }

  function openFirstNote() {
    const list = visibleNotes();
    if (list.length) openNote(list[0].id);
    else {
      state.noteId = null;
      $('editor-empty').style.display = 'flex';
      $('editor-wrap').style.display = 'none';
    }
  }

  function createNote() {
    const n = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.notes.push(n);
    state.noteId = n.id;
    renderNotesList();
    openNote(n.id);
    $('note-title').focus();
    // 不立即落盘：保存时会过滤空白笔记，避免误点「＋」产生垃圾空笔记
  }

  function deleteNote() {
    const n = state.notes.find((x) => x.id === state.noteId);
    if (!n) return;
    confirmModal({
      title: T('deleteNoteTitle'),
      text: T('confirmDelete', { name: n.title || T('untitled') }),
      onOk: () => {
        state.notes = state.notes.filter((x) => x.id !== n.id);
        saveNotes();
        renderNotesList(); // 删的是最后一篇时 openFirstNote 不会重绘列表，需手动刷新
        openFirstNote();
      },
    });
  }

  function updateNote(patch) {
    const n = state.notes.find((x) => x.id === state.noteId);
    if (!n) return;
    Object.assign(n, patch, { updatedAt: Date.now() });
    saveNotes();
  }

  function renderTags(tags) {
    const wrap = $('note-tags');
    wrap.querySelectorAll('.tag-pill').forEach((el) => el.remove());
    for (const t of tags) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.innerHTML = `#${escapeHtml(t)} <span class="tag-remove" title="${T('removeTag')}">✕</span>`;
      pill.querySelector('.tag-remove').onclick = () => {
        const next = tags.filter((x) => x !== t);
        updateNote({ tags: next });
        renderTags(next);
        renderNotesList(); // 同步列表项标签与标签云
      };
      wrap.insertBefore(pill, $('tag-input'));
    }
  }

  function addTag() {
    const input = $('tag-input');
    const val = input.value.trim().replace(/^#/, '');
    if (!val) return;
    const n = state.notes.find((x) => x.id === state.noteId);
    if (!n) return;
    if (!n.tags.includes(val)) {
      const tags = [...n.tags, val];
      updateNote({ tags });
      renderTags(tags);
      renderNotesList(); // 列表项显示新标签 + 标签云同步
    }
    input.value = '';
  }

  function setEditorMode(mode) {
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('note-content').style.display = mode === 'edit' ? '' : 'none';
    $('note-preview').style.display = mode === 'preview' ? '' : 'none';
    if (mode === 'preview') {
      const n = state.notes.find((x) => x.id === state.noteId);
      $('note-preview').innerHTML = renderMarkdown(n ? n.content : '');
    }
  }

  function renderTagCloud() {
    const cloud = $('tag-cloud');
    const keepScroll = cloud.scrollTop; // 重建后恢复滚动位置
    const counts = {};
    for (const n of state.notes) for (const t of n.tags) counts[t] = (counts[t] || 0) + 1;
    const tags = Object.keys(counts).sort();
    if (!tags.length) { cloud.hidden = true; cloud.innerHTML = ''; return; }
    cloud.hidden = false;
    cloud.innerHTML = `<div class="tag-cloud-label">${T('tags')}</div>` +
      tags.map((t) => `<span class="tag-chip${state.tagFilter === t ? ' active' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('');
    cloud.querySelectorAll('.tag-chip').forEach((chip) => {
      chip.onclick = () => {
        if (state.tagFilter === chip.dataset.tag) { clearTagFilter(); return; }
        // 先切视图再设过滤：switchView 会清掉 tagFilter，顺序反了过滤会被丢弃
        if (state.view !== 'notes') switchView('notes');
        state.tagFilter = chip.dataset.tag;
        state.search = '#' + chip.dataset.tag;
        $('search-input').value = state.search;
        renderTagCloud();
        renderNotesList();
      };
    });
    cloud.scrollTop = keepScroll;
  }

  function clearTagFilter() {
    // 搜索框还是「#标签」原样时才连同清空；用户手动改过搜索词则保留文字，仅取消标签过滤
    const wasTagSearch = state.tagFilter && state.search === '#' + state.tagFilter;
    state.tagFilter = null;
    if (wasTagSearch) {
      state.search = '';
      $('search-input').value = '';
    }
    renderTagCloud();
    renderNotesList();
  }

  /* ================= 密码库 ================= */
  const vaultSaver = makeSaver(async () => {
    if (!state.unlocked) return false; // 已锁定（密钥被清除），丢弃过期的保存请求
    const status = $('vault-save-status');
    status.textContent = T('saving');
    status.className = 'save-status saving';
    try {
      await api.vaultSave(state.vault);
    } catch {
      status.textContent = T('saveFailed');
      status.className = 'save-status error';
      return false;
    }
    status.textContent = T('saved');
    status.className = 'save-status saved';
    renderGroups();
    return true;
  });
  const saveVault = () => vaultSaver.schedule();

  const groupsOf = () => [...new Set(state.vault.map((e) => e.group || ''))].sort();

  function entryMatches(e) {
    if (state.group !== '全部' && (e.group || '') !== state.group) return false;
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return (e.name + ' ' + e.username + ' ' + e.url + ' ' + e.note).toLowerCase().includes(q);
  }

  function renderGroups() {
    const body = $('vault-groups-body');
    const keepScroll = body.scrollTop; // 重建后恢复滚动位置
    const groups = groupsOf();
    body.innerHTML = '';
    // value 存内部值（空串代表「默认」组），label 仅为显示名，二者分离避免过滤失效
    const mk = (label, value, active, count) => {
      const b = document.createElement('button');
      b.className = 'group-item' + (active ? ' active' : '');
      b.innerHTML = `<span class="group-name">${escapeHtml(label)}</span><span class="group-count">${count}</span>`;
      b.onclick = () => { state.group = value; renderGroups(); renderVaultList(); };
      return b;
    };
    body.appendChild(mk(T('all'), '全部', state.group === '全部', state.vault.length));
    for (const g of groups) {
      const count = state.vault.filter((e) => (e.group || '') === g).length;
      body.appendChild(mk(g || T('defaultGroup'), g, state.group === g, count));
    }
    body.scrollTop = keepScroll;
  }

  function renderVaultList() {
    const body = $('vault-list-body');
    const keepScroll = body.scrollTop; // 重建后恢复滚动位置
    $('vault-list-title').textContent = state.group === '全部' ? T('allItems') : (state.group || T('defaultGroup'));
    const list = state.vault.filter(entryMatches).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      body.innerHTML = `<div class="empty-hint">${state.search ? T('noEntriesMatch') : T('noEntries')}</div>`;
      body.scrollTop = keepScroll;
      return;
    }
    body.innerHTML = '';
    for (const e of list) {
      const el = document.createElement('div');
      el.className = 'entry-item' + (e.id === state.vaultId ? ' active' : '');
      el.innerHTML = `
        <div class="entry-item-name ${e.name ? '' : 'untitled'}">${escapeHtml(e.name || T('unnamed'))}</div>
        <div class="entry-item-username">${escapeHtml(e.username || '')}</div>
      `;
      el.onclick = () => openEntry(e.id);
      body.appendChild(el);
    }
    body.scrollTop = keepScroll;
  }

  function openEntry(id) {
    const e = state.vault.find((x) => x.id === id);
    if (!e) return;
    state.vaultId = id;
    renderVaultList();
    $('vault-empty').style.display = 'none';
    $('detail-wrap').style.display = 'flex';
    $('entry-name').value = e.name;
    $('entry-group').value = e.group;
    $('entry-username').value = e.username;
    $('entry-password').value = e.password;
    $('entry-password').type = 'password';
    $('toggle-password').style.color = ''; // 同步重置眼睛按钮高亮，避免与隐藏态不一致
    $('entry-url').value = e.url || '';
    $('entry-note').value = e.note || '';
    $('entry-meta').textContent = T('createdAt') + ' ' + fmtDate(e.createdAt) + ' · ' + T('updatedAt') + ' ' + fmtDate(e.updatedAt);
    $('vault-save-status').textContent = T('saved');
    $('vault-save-status').className = 'save-status saved';
    $('group-options').innerHTML = groupsOf().filter((g) => g !== e.group)
      .map((g) => `<option value="${escapeHtml(g)}">`).join('');
  }

  function updateEntry(patch) {
    const e = state.vault.find((x) => x.id === state.vaultId);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    saveVault();
    renderVaultList();
  }

  function createEntry() {
    const e = {
      id: crypto.randomUUID(),
      group: state.group !== '全部' ? state.group : '',
      name: '',
      username: '',
      password: '',
      url: '',
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.vault.push(e);
    state.vaultId = e.id;
    renderGroups();
    renderVaultList();
    openEntry(e.id);
    $('entry-name').focus();
    saveVault();
  }

  function deleteEntry() {
    const e = state.vault.find((x) => x.id === state.vaultId);
    if (!e) return;
    confirmModal({
      title: T('deleteEntryTitle'),
      text: T('confirmDelete', { name: e.name || T('unnamed') }),
      onOk: () => {
        state.vault = state.vault.filter((x) => x.id !== e.id);
        state.vaultId = null;
        saveVault();
        renderGroups();
        renderVaultList();
        $('vault-empty').style.display = 'flex';
        $('detail-wrap').style.display = 'none';
      },
    });
  }

  async function copyText(text, sensitive = false) {
    if (!text) { toast(T('nothingToCopy')); return; }
    await api.copy(text, sensitive); // sensitive：密码类内容，主进程 30 秒后自动清剪贴板
    toast(T('copied'));
  }

  /* ================= 语言切换 ================= */
  async function toggleLang() {
    applyLang(getLang() === 'zh' ? 'en' : 'zh');
    await api.settingsSave({ lang: getLang() });
    // 锁屏页只刷新文案：完整 initLock 会清空已输入的密码/密保内容、收起面板
    if (!state.unlocked) { refreshLockTexts(); return; }
    // 重渲染所有含动态文案的区域（placeholder 不在 data-i18n 体系内，需手动刷新）
    $('search-input').placeholder = state.view === 'notes' ? T('searchNotes') : T('searchVault');
    renderNotesList();
    renderGroups();
    renderVaultList();
    if (state.noteId) openNote(state.noteId);
    if (state.vaultId) openEntry(state.vaultId);
  }

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    // 窗口控制
    $('win-min').onclick = () => api.minimize();
    $('win-max').onclick = () => api.maximize();
    $('win-close').onclick = () => api.close();

    // 解锁
    $('lock-btn').onclick = handleLockSubmit;
    $('lock-input').onkeydown = (e) => { if (e.key === 'Enter') handleLockSubmit(); };
    $('lock-confirm').onkeydown = (e) => { if (e.key === 'Enter') handleLockSubmit(); };
    $('lock-app').onclick = lockApp;

    // 首次设置：密保问题行
    $('sec-add').onclick = () => { if (secCount < 3) { secCount++; renderSecRows(); } };

    // 忘记密码：密保重置
    $('forgot-btn').onclick = openSecReset;
    $('sec-back').onclick = closeSecReset;
    $('sec-reset-btn').onclick = submitSecReset;
    $('sec-answer').onkeydown = (e) => { if (e.key === 'Enter') submitSecReset(); };
    $('sec-new-confirm').onkeydown = (e) => { if (e.key === 'Enter') submitSecReset(); };

    // 密保问题管理（解锁后）
    $('sec-manage-btn').onclick = openSecManage;
    $('sec-manage-cancel').onclick = () => { $('sec-manage-mask').style.display = 'none'; };
    $('sec-manage-save').onclick = saveSecManage;
    $('sec-manage-pw').onkeydown = (e) => { if (e.key === 'Enter') saveSecManage(); };
    $('sec-manage-add').onclick = () => {
      if (secItems.length >= 3) return;
      secItems.push({ q: '', a: '' });
      renderSecManage(true);
    };

    // 备份 / 迁移
    $('backup-export-btn').onclick = exportBackup;
    $('backup-import-btn').onclick = importBackup;
    $('backup-import-lock').onclick = importBackupOnLock;

    // 通用密码确认弹窗
    $('prompt-ok').onclick = () => {
      if (!$('prompt-input').value) { $('prompt-error').textContent = T('errSecEmptyPwd'); return; }
      closePrompt($('prompt-input').value);
    };
    $('prompt-cancel').onclick = () => closePrompt(null);
    $('prompt-input').onkeydown = (e) => {
      if (e.key === 'Enter') $('prompt-ok').click();
      if (e.key === 'Escape') closePrompt(null);
    };

    // 密码库损坏时的重置入口（在 handleLockSubmit 中按需显示）
    $('vault-reset').onclick = () => {
      confirmModal({
        title: T('resetVault'),
        text: T('resetVaultConfirm'),
        okText: T('resetVault'),
        onOk: async () => {
          await api.vaultReset();
          initLock(); // vault.json 已删除，回到首次设置主密码
        },
      });
    };

    // 主进程在关窗前调用：把防抖中的编辑立即落盘
    window.__flushAll = async () => {
      await Promise.all([notesSaver.flush(), vaultSaver.flush()]);
    };

    // 最大化状态图标 / 标题栏样式
    api.onMaximizeChange((max) => {
      document.body.classList.toggle('maximized', max);
      $('win-max').classList.toggle('maximized', max);
    });

    // 语言切换
    $('toggle-lang').onclick = toggleLang;

    // 导航
    document.querySelectorAll('#main-nav .nav-item').forEach((b) => {
      b.onclick = () => switchView(b.dataset.view);
    });

    // 搜索
    $('search-input').oninput = (e) => {
      state.search = e.target.value.trim();
      // 标签过滤只在搜索词仍恰好是「#标签」时保留，否则转普通搜索
      //（clearTagFilter 内部已重绘列表）
      if (state.tagFilter && state.search !== '#' + state.tagFilter) clearTagFilter();
      else renderNotesList();
      renderVaultList();
      if (state.view === 'notes' && !visibleNotes().some((n) => n.id === state.noteId)) openFirstNote();
    };
    $('search-input').onkeydown = (e) => { if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); $('search-input').dispatchEvent(new Event('input')); } };

    // 笔记
    $('new-note').onclick = createNote;
    $('delete-note').onclick = deleteNote;
    $('note-title').oninput = (e) => {
      updateNote({ title: e.target.value });
      renderNotesList();
    };
    $('note-content').oninput = (e) => updateNote({ content: e.target.value });
    $('tag-input').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } };
    document.querySelectorAll('.seg-btn').forEach((b) => (b.onclick = () => setEditorMode(b.dataset.mode)));

    // 密码库
    $('new-entry').onclick = createEntry;
    $('delete-entry').onclick = deleteEntry;
    $('entry-name').oninput = (e) => updateEntry({ name: e.target.value });
    $('entry-group').oninput = (e) => {
      updateEntry({ group: e.target.value });
      $('group-options').innerHTML = groupsOf().filter((g) => g !== e.target.value)
        .map((g) => `<option value="${escapeHtml(g)}">`).join('');
    };
    $('entry-username').oninput = (e) => updateEntry({ username: e.target.value });
    $('entry-password').oninput = (e) => updateEntry({ password: e.target.value });
    $('entry-url').oninput = (e) => updateEntry({ url: e.target.value });
    $('entry-note').oninput = (e) => updateEntry({ note: e.target.value });

    // 复制
    document.querySelectorAll('.copy-btn[data-copy]').forEach((b) => {
      b.onclick = async () => {
        const isPassword = b.dataset.copy === 'password';
        const val = $(isPassword ? 'entry-password' : 'entry-username').value;
        await copyText(val, isPassword);
        b.classList.add('copied');
        setTimeout(() => b.classList.remove('copied'), 900);
      };
    });

    // 密码可见性
    $('toggle-password').onclick = () => {
      const input = $('entry-password');
      input.type = input.type === 'password' ? 'text' : 'password';
      $('toggle-password').style.color = input.type === 'text' ? 'var(--accent)' : '';
    };

    // 密码生成
    $('gen-password').onclick = () => {
      const pw = generatePassword(16);
      $('entry-password').value = pw;
      $('entry-password').type = 'text';
      $('toggle-password').style.color = 'var(--accent)';
      updateEntry({ password: pw });
      copyText(pw, true);
    };

    // Markdown 链接：http(s) 交给系统浏览器；其余（含相对/file 链接）一律拦截，
    // 防止相对链接把整窗导航到本地文件、应用被顶掉
    $('note-preview').addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      if (/^https?:\/\//.test(a.href)) api.openLink(a.href);
    });
  }

  /* ---------- 启动 ---------- */
  bindEvents();
  (async () => {
    const settings = await api.settingsLoad();
    applyLang(settings.lang || 'en'); // 默认英文；手动切换后偏好保存，重启保持
    initLock();
  })();
})();
