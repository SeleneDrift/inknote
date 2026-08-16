const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 数据目录：开发时在项目内 data/，打包后放系统 userData
const dataDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'data');
const notesFile = path.join(dataDir, 'notes.json');
const vaultFile = path.join(dataDir, 'vault.json');
const settingsFile = path.join(dataDir, 'settings.json');

// 解锁后缓存在主进程内存的 recoveryKey，绝不进入渲染进程。
// 架构：所有数据（密码库、笔记）用随机 recoveryKey 加密；
// 主密码与密保答案只是「解开 recoveryKey」的两把备用钥匙，重设任一密码不动数据。
let recoveryKey = null;

// 复制敏感内容（密码）后延时清空剪贴板的定时器
let clipboardClearTimer = null;

// 先写临时文件再原子替换：写入途中崩溃/断电最多丢掉 .tmp，不会截断正式文件。
// rename 前先 fsync 数据，防止断电时目录项已换而数据页未落盘
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function deriveKey(masterPassword, salt) {
  return crypto.scryptSync(String(masterPassword), salt, 32, {
    N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
}

// 校验口令派生密钥是否匹配存储的 verifier（sha256 摘要，timingSafeEqual 防时序）
function verifyKey(key, verifierHex) {
  const expect = Buffer.from(String(verifierHex ?? ''), 'hex');
  const actual = crypto.createHash('sha256').update(key).digest();
  return expect.length === actual.length && crypto.timingSafeEqual(expect, actual);
}

// 生成一把 recoveryKey 的「钥匙层」：{ salt, verifier, iv, data }（data 为 recoveryKey 密文）
function makeKeyLayer(pass, key) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = deriveKey(pass, salt);
  const { iv, data } = encrypt(Buffer.from(key), derived);
  return { salt, verifier: crypto.createHash('sha256').update(derived).digest('hex'), iv, data };
}

// 校验密保输入：每个问题最多 3 个，问题 ≤100 字、答案非空且 ≤200 字
function sanitizeSecurity(security) {
  if (!Array.isArray(security)) return [];
  return security.slice(0, 3).flatMap((s) => {
    const q = String(s.q ?? '').trim();
    const a = String(s.a ?? '').trim();
    if (!q || !a || q.length > 100 || a.length > 200) return [];
    return [{ q, a }];
  });
}

/* ---------- 备份 / 跨设备迁移 ---------- */
const BACKUP_KIND = 'inknote-backup';

// 读取备份文件并做结构校验（识别码、版本上限、必备字段、体积上限）
function readBackupFile(file) {
  const st = fs.statSync(file);
  const bad = () => { const e = new Error('not a backup'); e.code = 'NOT_BACKUP'; throw e; };
  if (st.size > 128 * 1024 * 1024) bad();
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!obj || obj.kind !== BACKUP_KIND || typeof obj.v !== 'number' || obj.v > 1) bad();
  for (const k of ['master', 'vault', 'notes']) {
    if (!obj[k] || typeof obj[k].iv !== 'string' || typeof obj[k].data !== 'string') bad();
  }
  if (!Array.isArray(obj.security)) obj.security = [];
  return obj;
}

// 规范化导入数据：补缺字段、纠正类型；无合法 id 的条目丢弃，避免异常备份让渲染层崩溃
function normalizeNotes(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n === 'object' && typeof n.id === 'string' && n.id)
    .map((n) => ({
      id: n.id,
      title: typeof n.title === 'string' ? n.title : '',
      content: typeof n.content === 'string' ? n.content : '',
      tags: Array.isArray(n.tags) ? n.tags.filter((t) => typeof t === 'string' && t) : [],
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
      updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : Date.now(),
    }));
}

function normalizeEntries(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.id)
    .map((e) => ({
      id: e.id,
      group: typeof e.group === 'string' ? e.group : '',
      name: typeof e.name === 'string' ? e.name : '',
      username: typeof e.username === 'string' ? e.username : '',
      password: typeof e.password === 'string' ? e.password : '',
      url: typeof e.url === 'string' ? e.url : '',
      note: typeof e.note === 'string' ? e.note : '',
      createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
      updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now(),
    }));
}

// 按 id 合并，updatedAt 新者胜；返回合并结果与增/改计数
function mergeById(local, incoming) {
  const byId = new Map(local.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const cur = byId.get(item.id);
    if (!cur) { byId.set(item.id, item); added++; }
    else if (item.updatedAt > cur.updatedAt) { byId.set(item.id, item); updated++; }
  }
  return { list: [...byId.values()], added, updated };
}

// AES-256-GCM 加密，输出 hex。plain 可为任意对象（JSON 序列化）或 Buffer
function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const input = Buffer.isBuffer(plain) ? plain : Buffer.from(JSON.stringify(plain), 'utf8');
  const body = Buffer.concat([cipher.update(input), cipher.final()]);
  return { iv: iv.toString('hex'), data: Buffer.concat([body, cipher.getAuthTag()]).toString('hex') };
}

// AES-256-GCM 解密，返回 Buffer
function decryptBuf(file, key) {
  const iv = Buffer.from(file.iv, 'hex');
  const buf = Buffer.from(file.data, 'hex');
  const body = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

// 解密并解析为对象
function decrypt(file, key) {
  return JSON.parse(decryptBuf(file, key).toString('utf8'));
}

function readVaultFile() {
  return JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
}

// 开发模式下给窗口/任务栏设置应用图标；打包后自动使用 exe 内嵌图标
const devIcon = !app.isPackaged && fs.existsSync(path.join(__dirname, 'build', 'icon.ico'))
  ? path.join(__dirname, 'build', 'icon.ico')
  : undefined;

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    icon: devIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 关窗前给渲染进程一次落盘防抖中编辑的机会，完成后再真正关闭。
  // 覆盖标题栏 X / Alt+F4 / 系统关机等所有经主进程 BrowserWindow.close() 的路径。
  let flushed = false;
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    if (win.__flushing) return;
    win.__flushing = true;
    win.webContents
      .executeJavaScript('Promise.resolve(window.__flushAll ? window.__flushAll() : null)')
      .catch(() => {})
      .finally(() => {
        flushed = true;
        if (!win.isDestroyed()) win.close();
      });
  });

  // 把最大化状态同步给渲染进程（切换「最大化/还原」图标）
  const sendMax = () => {
    if (!win.isDestroyed()) win.webContents.send('win:maximized', win.isMaximized());
  };
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  // 外部链接一律交给系统浏览器；应用自身只在原地刷新（Ctrl+R）。
  // 其余 will-navigate 一律拒绝——包括 Markdown 预览里被解析成 file:// 的相对链接
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url === win.webContents.getURL()) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

// 单实例：重复启动时聚焦已有窗口；未拿到锁的实例不再初始化任何窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    fs.mkdirSync(dataDir, { recursive: true });

    ipcMain.handle('app:init', () => {
      const firstRun = !fs.existsSync(vaultFile);
      // 密保问题文本（明文，非机密）随 init 返回，解锁页据此显示「忘记密码」入口
      let security = [];
      if (!firstRun) {
        try { security = (JSON.parse(fs.readFileSync(vaultFile, 'utf8')).security ?? []).map((s) => s.q); } catch {}
      }
      return { firstRun, security };
    });

    // 偏好设置（语言等，明文，非机密）
    ipcMain.handle('settings:load', () => {
      try {
        return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      } catch {
        return {};
      }
    });

    ipcMain.handle('settings:save', (_e, settings) => {
      writeJsonAtomic(settingsFile, settings);
      return { ok: true };
    });

    // 首次设置主密码（可选 1-3 个密保问题，用于忘记密码时重设主密码）
    ipcMain.handle('vault:setup', (_e, masterPassword, security) => {
      if (fs.existsSync(vaultFile)) throw new Error('vault already exists');
      if (typeof masterPassword !== 'string' || masterPassword.length < 6) {
        throw new Error('master password too short');
      }
      const recovery = crypto.randomBytes(32);
      const sec = sanitizeSecurity(security).map((s) => ({ q: s.q, ...makeKeyLayer(s.a, recovery) }));
      const file = {
        v: 2,
        master: makeKeyLayer(masterPassword, recovery),
        security: sec,
        vault: encrypt([], recovery),
      };
      writeJsonAtomic(vaultFile, file);
      recoveryKey = recovery;
      return { ok: true };
    });

    // 解锁：主密码解开 recoveryKey，再解密密码库
    ipcMain.handle('vault:unlock', (_e, masterPassword) => {
      if (typeof masterPassword !== 'string' || !masterPassword) return { ok: false, error: 'empty' };
      try {
        const file = readVaultFile();
        if (!file.master) {
          // v1 旧格式迁移：验证旧主密码后，数据改由新随机 recoveryKey 加密（后续可设密保）
          const key = deriveKey(masterPassword, Buffer.from(file.salt, 'hex'));
          if (!verifyKey(key, file.verifier)) return { ok: false, error: 'wrong-password', hasSecurity: false };
          const entries = decrypt(file, key);
          const recovery = crypto.randomBytes(32);
          writeJsonAtomic(vaultFile, {
            v: 2,
            master: { salt: file.salt, verifier: file.verifier, ...encrypt(Buffer.from(recovery), key) },
            security: [],
            vault: encrypt(entries, recovery),
          });
          recoveryKey = recovery;
          return { ok: true, entries };
        }
        const key = deriveKey(masterPassword, file.master.salt);
        if (!verifyKey(key, file.master.verifier)) {
          return { ok: false, error: 'wrong-password', hasSecurity: file.security?.length > 0 };
        }
        recoveryKey = decryptBuf(file.master, key);
        const entries = decrypt(file.vault, recoveryKey);
        return { ok: true, entries };
      } catch {
        return { ok: false, error: 'corrupted', hasSecurity: false };
      }
    });

    // 密保重置主密码：答对任一密保问题 → 取出 recoveryKey → 换新主密码的钥匙层（数据不动）
    ipcMain.handle('vault:resetPassword', (_e, idx, answer, newPassword) => {
      if (typeof idx !== 'number' || typeof answer !== 'string' || !answer) return { ok: false, error: 'bad-input' };
      if (typeof newPassword !== 'string' || newPassword.length < 6) return { ok: false, error: 'too-short' };
      try {
        const file = readVaultFile();
        const sec = file.security?.[idx];
        if (!sec) return { ok: false, error: 'bad-input' };
        const key = deriveKey(answer, sec.salt);
        if (!verifyKey(key, sec.verifier)) return { ok: false, error: 'wrong-answer' };
        const recovery = decryptBuf(sec, key);
        const entries = decrypt(file.vault, recovery); // 顺带验证 recoveryKey 能解开数据
        file.master = makeKeyLayer(newPassword, recovery);
        writeJsonAtomic(vaultFile, file);
        recoveryKey = recovery;
        return { ok: true, entries };
      } catch {
        return { ok: false, error: 'corrupted' };
      }
    });

    // 解锁后管理密保问题：验证主密码 → 保留指定旧问题层、追加新问题层（数据与主密码不动）。
    // 必须验证主密码：防止趁解锁间隙植入新密保问题作为「后门」
    ipcMain.handle('security:update', (_e, masterPassword, keepIndices, add) => {
      if (typeof masterPassword !== 'string' || !masterPassword) return { ok: false, error: 'wrong-password' };
      try {
        const file = readVaultFile();
        if (!file.master) return { ok: false, error: 'corrupted' };
        const key = deriveKey(masterPassword, file.master.salt);
        if (!verifyKey(key, file.master.verifier)) return { ok: false, error: 'wrong-password' };
        const recovery = decryptBuf(file.master, key);
        decrypt(file.vault, recovery); // 顺带验证这把钥匙确实解得开数据
        const kept = [...new Set(Array.isArray(keepIndices) ? keepIndices : [])]
          .filter((i) => Number.isInteger(i) && i >= 0 && i < (file.security?.length ?? 0))
          .map((i) => file.security[i]);
        const adding = sanitizeSecurity(add);
        if (kept.length + adding.length > 3) return { ok: false, error: 'too-many' };
        file.security = [...kept, ...adding.map((s) => ({ q: s.q, ...makeKeyLayer(s.a, recovery) }))];
        writeJsonAtomic(vaultFile, file);
        return { ok: true, security: file.security.map((s) => s.q) };
      } catch {
        return { ok: false, error: 'corrupted' };
      }
    });

    // ---------- 备份 / 跨设备迁移 ----------
    // 导出：验证主密码 → 解密当前数据 → 重新包装/加密为单文件备份。
    // filePath 供端到端测试指定路径；正常 UI 流程不传，弹系统保存对话框
    ipcMain.handle('backup:export', async (_e, masterPassword, filePath) => {
      if (!recoveryKey) return { ok: false, error: 'not-unlocked' };
      if (typeof masterPassword !== 'string' || !masterPassword) return { ok: false, error: 'wrong-password' };
      try {
        const file = readVaultFile();
        const key = deriveKey(masterPassword, file.master.salt);
        if (!verifyKey(key, file.master.verifier)) return { ok: false, error: 'wrong-password' };
        const recovery = decryptBuf(file.master, key);
        const entries = normalizeEntries(decrypt(file.vault, recovery));
        let notes = [];
        if (fs.existsSync(notesFile)) {
          const obj = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
          notes = normalizeNotes(Array.isArray(obj) ? obj : decrypt(obj, recovery));
        }
        const bundle = {
          v: 1,
          kind: BACKUP_KIND,
          exportedAt: new Date().toISOString(),
          master: makeKeyLayer(masterPassword, recovery), // 新盐重新包装，不复用库内层
          security: Array.isArray(file.security) ? file.security : [],
          vault: encrypt(entries, recovery),
          notes: encrypt(notes, recovery),
        };
        let target = filePath;
        if (!target) {
          const d = new Date();
          const two = (n) => String(n).padStart(2, '0');
          const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
          const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          const r = await dialog.showSaveDialog(owner, {
            defaultPath: `InkNote-backup-${stamp}.ink`,
            filters: [
              { name: 'InkNote Backup', extensions: ['ink'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
          if (r.canceled || !r.filePath) return { ok: false, error: 'canceled' };
          target = r.filePath;
        }
        writeJsonAtomic(target, bundle);
        return { ok: true, path: target };
      } catch {
        return { ok: false, error: 'corrupted' };
      }
    });

    // 选备份文件：结构校验后返回元信息（不含数据本身）
    ipcMain.handle('backup:pick', async (_e, filePath) => {
      try {
        let file = filePath;
        if (!file) {
          const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          const r = await dialog.showOpenDialog(owner, {
            properties: ['openFile'],
            filters: [
              { name: 'InkNote Backup', extensions: ['ink'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
          if (r.canceled || !r.filePaths.length) return { ok: false, error: 'canceled' };
          file = r.filePaths[0];
        }
        const obj = readBackupFile(file);
        return { ok: true, path: file, exportedAt: obj.exportedAt ?? null };
      } catch (e) {
        return { ok: false, error: e.code === 'NOT_BACKUP' ? 'not-backup' : 'corrupted' };
      }
    });

    // 空机导入：备份的钥匙层（主密码+密保）与数据整体落地，沿用原主密码。
    // 仅允许在无本地库时执行；本机已有数据请走解锁后的合并导入
    ipcMain.handle('backup:restore', (_e, masterPassword, filePath) => {
      if (typeof masterPassword !== 'string' || !masterPassword) return { ok: false, error: 'wrong-password' };
      if (fs.existsSync(vaultFile)) return { ok: false, error: 'vault-exists' };
      try {
        const obj = readBackupFile(filePath);
        const key = deriveKey(masterPassword, obj.master.salt);
        if (!verifyKey(key, obj.master.verifier)) return { ok: false, error: 'wrong-password' };
        const recovery = decryptBuf(obj.master, key);
        const entries = normalizeEntries(decrypt(obj.vault, recovery));
        const notes = normalizeNotes(decrypt(obj.notes, recovery));
        writeJsonAtomic(vaultFile, {
          v: 2,
          master: obj.master,
          security: obj.security,
          vault: encrypt(entries, recovery),
        });
        writeJsonAtomic(notesFile, { v: 1, ...encrypt(notes, recovery) });
        recoveryKey = null; // 导入后要求重新解锁
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.code === 'NOT_BACKUP' ? 'not-backup' : 'corrupted' };
      }
    });

    // 合并导入（本机已有库，需解锁）：只取备份数据，丢弃备份的钥匙层，
    // 与本地数据按 id 合并（updatedAt 新者胜），再以本机 recoveryKey 重新加密写回
    ipcMain.handle('backup:merge', (_e, masterPassword, filePath) => {
      if (!recoveryKey) return { ok: false, error: 'not-unlocked' };
      if (typeof masterPassword !== 'string' || !masterPassword) return { ok: false, error: 'wrong-password' };
      try {
        const obj = readBackupFile(filePath);
        const key = deriveKey(masterPassword, obj.master.salt);
        if (!verifyKey(key, obj.master.verifier)) return { ok: false, error: 'wrong-password' };
        const recovery = decryptBuf(obj.master, key);
        const inNotes = normalizeNotes(decrypt(obj.notes, recovery));
        const inEntries = normalizeEntries(decrypt(obj.vault, recovery));

        const localFile = readVaultFile();
        const localEntries = normalizeEntries(decrypt(localFile.vault, recoveryKey));
        let localNotes = [];
        if (fs.existsSync(notesFile)) {
          const n = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
          localNotes = normalizeNotes(Array.isArray(n) ? n : decrypt(n, recoveryKey));
        }
        const mNotes = mergeById(localNotes, inNotes);
        const mEntries = mergeById(localEntries, inEntries);

        localFile.vault = encrypt(mEntries.list, recoveryKey);
        writeJsonAtomic(vaultFile, localFile);
        writeJsonAtomic(notesFile, { v: 1, ...encrypt(mNotes.list, recoveryKey) });
        return {
          ok: true,
          notes: mNotes.list,
          entries: mEntries.list,
          summary: {
            notesAdded: mNotes.added, notesUpdated: mNotes.updated,
            entriesAdded: mEntries.added, entriesUpdated: mEntries.updated,
          },
        };
      } catch (e) {
        return { ok: false, error: e.code === 'NOT_BACKUP' ? 'not-backup' : 'corrupted' };
      }
    });

    ipcMain.handle('vault:lock', () => {
      recoveryKey = null;
      return { ok: true };
    });

    // 密码库无法解密或未设密保时的最后手段：删除全部加密数据，重新设置主密码
    ipcMain.handle('vault:reset', () => {
      recoveryKey = null;
      for (const f of [vaultFile, notesFile]) if (fs.existsSync(f)) fs.rmSync(f);
      return { ok: true };
    });

    // 保存密码库：用 recoveryKey 重新加密写回
    ipcMain.handle('vault:save', (_e, entries) => {
      if (!recoveryKey) throw new Error('vault is locked');
      const file = readVaultFile();
      file.vault = encrypt(entries, recoveryKey);
      writeJsonAtomic(vaultFile, file);
      return { ok: true };
    });

    // 加载笔记：解锁后用 recoveryKey 解密；旧明文数组首次加载时自动迁移为加密存储
    ipcMain.handle('notes:load', () => {
      if (!recoveryKey) throw new Error('vault is locked');
      if (!fs.existsSync(notesFile)) return [];
      try {
        const obj = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
        if (Array.isArray(obj)) {
          writeJsonAtomic(notesFile, { v: 1, ...encrypt(obj, recoveryKey) });
          return obj;
        }
        return decrypt(obj, recoveryKey);
      } catch {
        // 损坏时先备份原文件再从空列表开始，避免下一次自动保存把可抢救的数据覆盖掉
        try { fs.copyFileSync(notesFile, notesFile + '.corrupt'); } catch {}
        return [];
      }
    });

    ipcMain.handle('notes:save', (_e, notes) => {
      if (!recoveryKey) throw new Error('vault is locked');
      writeJsonAtomic(notesFile, { v: 1, ...encrypt(notes, recoveryKey) });
      return { ok: true };
    });

    ipcMain.handle('clipboard:write', (_e, text, sensitive) => {
      const str = String(text ?? '');
      clipboard.writeText(str);
      clearTimeout(clipboardClearTimer);
      if (sensitive && str) {
        const copied = str;
        // 30 秒后清空密码，避免长期残留在剪贴板；若用户已复制其它内容则不动
        clipboardClearTimer = setTimeout(() => {
          if (clipboard.readText() === copied) clipboard.clear();
        }, 30_000);
      }
      return { ok: true };
    });

    ipcMain.handle('link:open', (_e, url) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    });

    const winCtl = (e, fn) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (win) fn(win);
    };
    ipcMain.handle('win:minimize', (e) => winCtl(e, (w) => w.minimize()));
    ipcMain.handle('win:maximize', (e) => winCtl(e, (w) => (w.isMaximized() ? w.unmaximize() : w.maximize())));
    ipcMain.handle('win:close', (e) => winCtl(e, (w) => w.close()));

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
