/* 灵感簿 · 中英文切换 */
(() => {
  const DICT = {
    zh: {
      appName: 'InkNote',
      winMin: '最小化', winMax: '最大化', winClose: '关闭',
      lockTitleUnlock: '解锁 InkNote', lockTitleSetup: '设置主密码',
      lockSubtitleUnlock: '输入主密码，继续使用',
      lockSubtitleSetup: '主密码用于加密保护你的密码库',
      lockInputPh: '主密码', lockConfirmPh: '再次输入，确认主密码',
      lockHint: '主密码用于加密保护你的密码库，请勿遗忘 —— 它无法找回。',
      lockBtnUnlock: '解锁', lockBtnStart: '开始使用',
      errEmptyPwd: '请输入主密码', errTooShort: '主密码至少 6 位',
      errMismatch: '两次输入不一致', errInitFail: '初始化失败',
      errWrongPwd: '主密码错误', errCorrupt: '数据无法解密，可能已损坏',
      resetVault: '重置密码库', resetVaultConfirm: '重置将永久删除密码库与笔记中的全部数据，且无法恢复。之后需重新设置主密码。确定重置吗？',
      resetVaultHint: '数据无法解密时，重置密码库可重新开始，但全部数据将被永久删除。',
      forgotPassword: '忘记密码？',
      secQuestion: '密保问题', secAnswerPh: '答案',
      secNewPh: '新主密码', secNewConfirmPh: '确认新主密码',
      secResetBtn: '重置密码', secBack: '← 返回解锁',
      secSetupHint: '密保问题（可选）——忘记主密码时可凭答案重置，数据不丢失',
      secQPh: '问题，例如：你的小学名称？', secAPh: '答案',
      secAdd: '＋ 添加问题', secRemove: '移除',
      secManage: '密保问题', secManageTitle: '管理密保问题',
      secManageSub: '忘记主密码时，答对任一问题即可重置主密码；最多保留 3 个。',
      secNewRow: '新增问题', secAnswerKept: '答案保持不变',
      save: '保存', secUpdated: '密保问题已更新',
      errSecEmptyPwd: '请输入主密码以确认', errSecIncomplete: '新增问题的问题与答案需同时填写',
      errSecTooLong: '问题或答案过长', errSecFull: '最多 3 个密保问题',
      secRemoveAllConfirm: '保存后将没有任何密保问题，忘记主密码时数据将无法找回。确定保存吗？',
      backupExport: '导出备份', backupImport: '导入备份',
      backupExportTitle: '导出备份',
      backupExportSub: '备份包含全部笔记与密码条目，用主密码加密。请像保护密码库一样保管备份文件。',
      backupImportTitle: '导入备份',
      backupImportRestoreSub: '输入导出该备份时使用的主密码；导入后沿用原主密码与密保问题。',
      backupImportMergeSub: '输入该备份的主密码（与本机主密码无关）；数据将合并进本机，较新者胜。',
      backupExported: '备份已导出', backupRestored: '导入完成，请用原主密码解锁',
      backupMerged: '合并完成：笔记新增 {n1}、更新 {n2}；条目新增 {e1}、更新 {e2}',
      errNotBackup: '不是有效的 InkNote 备份文件',
      errVaultExists: '本机已有密码库，请解锁后从侧栏「导入备份」合并',
      confirm: '确定',
      errSecAnswer: '密保答案错误', errSecEmpty: '请选择问题并填写答案',
      errSecShort: '新主密码至少 6 位', errSecMismatch: '两次输入不一致',
      pwdResetDone: '主密码已重置，数据已保留',
      welcome: '欢迎使用 InkNote',
      searchNotes: '搜索笔记…', searchVault: '搜索密码库…',
      notes: '笔记', vault: '密码库', tags: '标签', lock: '锁定',
      switchLang: '切换语言',
      newNote: '新建笔记',
      editorEmpty: '从左侧选择一篇笔记，或点击「＋」新建',
      edit: '编辑', preview: '预览', delete: '删除',
      untitled: '无标题',
      tagInputPh: '添加标签，回车确认',
      contentPh: '写点什么…（支持 Markdown）',
      noNotes: '还没有笔记，点击右上角「＋」新建',
      noNotesMatch: '没有匹配的笔记',
      noEntries: '暂无条目，点击右上角「＋」新建',
      noEntriesMatch: '没有匹配的条目',
      groups: '分组', allItems: '全部条目', all: '全部', defaultGroup: '默认',
      newEntry: '新建条目',
      vaultEmpty: '从左侧选择一个条目，或新建一个',
      fieldName: '名称', fieldGroup: '分组', fieldUsername: '用户名 / 账号',
      fieldPassword: '密码', fieldUrl: '网址', fieldNote: '备注',
      unnamed: '未命名',
      copyUsername: '复制账号', copyPassword: '复制密码',
      toggleVisibility: '显示 / 隐藏密码', genPassword: '生成强密码',
      copied: '已复制到剪贴板', nothingToCopy: '没有可复制的内容',
      saved: '已保存', saving: '正在保存…', saveFailed: '保存失败',
      deleteNoteTitle: '删除笔记', deleteEntryTitle: '删除条目',
      confirmDelete: '确定删除「{name}」吗？此操作不可撤销。',
      cancel: '取消', removeTag: '移除标签',
      today: '今天', yesterday: '昨天',
      createdAt: '创建于', updatedAt: '更新于',
    },
    en: {
      appName: 'InkNote',
      winMin: 'Minimize', winMax: 'Maximize', winClose: 'Close',
      lockTitleUnlock: 'Unlock InkNote', lockTitleSetup: 'Set Master Password',
      lockSubtitleUnlock: 'Enter your master password',
      lockSubtitleSetup: 'Protects your password vault with encryption',
      lockInputPh: 'Master password', lockConfirmPh: 'Re-enter to confirm',
      lockHint: 'Your master password encrypts the vault. It cannot be recovered — don’t forget it.',
      lockBtnUnlock: 'Unlock', lockBtnStart: 'Get Started',
      errEmptyPwd: 'Enter your master password', errTooShort: 'At least 6 characters',
      errMismatch: 'Passwords do not match', errInitFail: 'Setup failed',
      errWrongPwd: 'Wrong password', errCorrupt: 'Cannot decrypt data — it may be corrupted',
      resetVault: 'Reset vault', resetVaultConfirm: 'Resetting permanently deletes all data in the vault and notes, and cannot be undone. You will set a new master password afterwards. Continue?',
      resetVaultHint: 'When data cannot be decrypted, reset the vault to start over — all data will be permanently deleted.',
      forgotPassword: 'Forgot password?',
      secQuestion: 'Security question', secAnswerPh: 'Answer',
      secNewPh: 'New master password', secNewConfirmPh: 'Confirm new master password',
      secResetBtn: 'Reset password', secBack: '← Back to unlock',
      secSetupHint: 'Security questions (optional) — answer them to reset your password if you forget it; data is kept',
      secQPh: 'Question, e.g. Your elementary school?', secAPh: 'Answer',
      secAdd: '+ Add question', secRemove: 'Remove',
      secManage: 'Security Questions', secManageTitle: 'Manage Security Questions',
      secManageSub: 'Answer any one question to reset the master password if you forget it. Up to 3 questions.',
      secNewRow: 'New question', secAnswerKept: 'Answer unchanged',
      save: 'Save', secUpdated: 'Security questions updated',
      errSecEmptyPwd: 'Enter your master password to confirm', errSecIncomplete: 'New questions need both question and answer',
      errSecTooLong: 'Question or answer is too long', errSecFull: 'Up to 3 security questions',
      secRemoveAllConfirm: 'No security questions will remain — if you forget the master password, data cannot be recovered. Save anyway?',
      backupExport: 'Export Backup', backupImport: 'Import Backup',
      backupExportTitle: 'Export Backup',
      backupExportSub: 'The backup contains all notes and vault entries, encrypted with your master password. Store it as safely as your vault.',
      backupImportTitle: 'Import Backup',
      backupImportRestoreSub: 'Enter the master password used when the backup was exported; the original password and security questions carry over.',
      backupImportMergeSub: "Enter the backup's master password (not this device's). Data merges into this device; newer items win.",
      backupExported: 'Backup exported', backupRestored: 'Import complete — unlock with the original master password',
      backupMerged: 'Merged: notes {n1} added / {n2} updated; entries {e1} added / {e2} updated',
      errNotBackup: 'Not a valid InkNote backup file',
      errVaultExists: 'This device already has a vault — unlock and merge via "Import Backup" in the sidebar',
      confirm: 'OK',
      errSecAnswer: 'Wrong security answer', errSecEmpty: 'Pick a question and enter the answer',
      errSecShort: 'New master password must be at least 6 characters', errSecMismatch: 'Passwords do not match',
      pwdResetDone: 'Master password reset — data kept',
      welcome: 'Welcome to InkNote',
      searchNotes: 'Search notes…', searchVault: 'Search vault…',
      notes: 'Notes', vault: 'Vault', tags: 'Tags', lock: 'Lock',
      switchLang: 'Switch language',
      newNote: 'New note',
      editorEmpty: 'Select a note on the left, or click ＋',
      edit: 'Edit', preview: 'Preview', delete: 'Delete',
      untitled: 'Untitled',
      tagInputPh: 'Add tag, press Enter',
      contentPh: 'Write something… (Markdown supported)',
      noNotes: 'No notes yet — click ＋ to create one',
      noNotesMatch: 'No matching notes',
      noEntries: 'No entries — click ＋ to create one',
      noEntriesMatch: 'No matching entries',
      groups: 'Groups', allItems: 'All entries', all: 'All', defaultGroup: 'Default',
      newEntry: 'New entry',
      vaultEmpty: 'Select an entry on the left, or create one',
      fieldName: 'Name', fieldGroup: 'Group', fieldUsername: 'Username',
      fieldPassword: 'Password', fieldUrl: 'URL', fieldNote: 'Note',
      unnamed: 'Untitled',
      copyUsername: 'Copy username', copyPassword: 'Copy password',
      toggleVisibility: 'Show / hide password', genPassword: 'Generate strong password',
      copied: 'Copied to clipboard', nothingToCopy: 'Nothing to copy',
      saved: 'Saved', saving: 'Saving…', saveFailed: 'Save failed',
      deleteNoteTitle: 'Delete note', deleteEntryTitle: 'Delete entry',
      confirmDelete: 'Delete "{name}"? This cannot be undone.',
      cancel: 'Cancel', removeTag: 'Remove tag',
      today: 'Today', yesterday: 'Yesterday',
      createdAt: 'Created', updatedAt: 'Updated',
    },
  };

  let lang = 'zh';
  const dict = () => DICT[lang] || DICT.zh;

  // 全局翻译函数：T('key') 或 T('key', {name: x}) 插值
  window.T = (key, vars) => {
    let s = dict()[key];
    if (s === undefined) return key;
    // 用函数替换：值里若含 $&、$' 等会被字符串替换当作特殊模式
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, () => v);
    return s;
  };

  window.applyLang = (l) => {
    lang = l === 'en' ? 'en' : 'zh';
    const d = dict();
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    // 静态文案
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (d[k] !== undefined) el.textContent = d[k];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      const k = el.dataset.i18nPh;
      if (d[k] !== undefined) el.placeholder = d[k];
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.dataset.i18nTitle;
      if (d[k] !== undefined) el.title = d[k];
    });
    // 语言按钮：显示目标语言
    const btn = document.getElementById('toggle-lang');
    if (btn) btn.textContent = lang === 'zh' ? 'EN' : '中文';
  };

  window.getLang = () => lang;
})();
