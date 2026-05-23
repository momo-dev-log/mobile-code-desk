(() => {
  'use strict';

  const STORAGE_KEY = 'mcd_projects';
  const LAST_ID_KEY  = 'mcd_lastId';

  let projects        = [];
  let currentId       = null;
  let isDirty         = false;
  let saveTimer       = null;
  let confirmCallback = null;
  let renameTargetId  = null;
  let lintTimers      = { html: null, css: null, js: null };
  let consoleLogs     = [];

  // ── ID generation ──────────────────────────────
  function genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  // ── Storage ──────────────────────────────────
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) { projects = parsed; return; }
      }
    } catch (_) { /* ignore corrupted data */ }
    projects = [];
  }

  function persistProjects() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      if (currentId) localStorage.setItem(LAST_ID_KEY, currentId);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || (e.code && e.code === 22)) {
        projects.forEach(p => {
          if (Array.isArray(p.history) && p.history.length > 0) {
            p.history = p.history.slice(-Math.max(1, Math.floor(p.history.length / 2)));
          }
        });
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
          if (currentId) localStorage.setItem(LAST_ID_KEY, currentId);
        } catch (_) { showToast('保存できませんでした'); }
      } else {
        showToast('保存できませんでした');
      }
    }
  }

  // ── History snapshot ──────────────────────────────
  function saveHistorySnapshot(reason, snap) {
    const p = currentProject();
    if (!p) return false;
    if (!snap.html.trim() && !snap.css.trim() && !snap.js.trim()) return false;
    if (!Array.isArray(p.history)) p.history = [];
    const last = p.history[p.history.length - 1];
    if (last && last.html === snap.html && last.css === snap.css && last.js === snap.js) return false;
    p.history.push({ id: genId(), reason: reason, savedAt: new Date().toISOString(), html: snap.html, css: snap.css, js: snap.js });
    if (p.history.length > 10) p.history = p.history.slice(-10);
    return true;
  }

  // ── Project helpers ──────────────────────────
  function findProject(id) {
    return projects.find(p => p.id === id) || null;
  }

  function currentProject() {
    return findProject(currentId);
  }

  function buildProject(title) {
    return {
      id:        genId(),
      title:     title || '新規プロジェクト',
      html:      '',
      css:       '',
      js:        '',
      updatedAt: new Date().toISOString()
    };
  }

  // ── Editor helpers ────────────────────────────
  function editorVal(type) {
    return document.getElementById('editor-' + type).value;
  }

  function captureEditors() {
    const p = currentProject();
    if (!p) return;
    p.html      = editorVal('html');
    p.css       = editorVal('css');
    p.js        = editorVal('js');
    p.updatedAt = new Date().toISOString();
  }

  function loadIntoEditors(project) {
    document.getElementById('editor-html').value = project ? project.html : '';
    document.getElementById('editor-css').value  = project ? project.css  : '';
    document.getElementById('editor-js').value   = project ? project.js   : '';
    lintAll();
  }

  // ── Save status ─────────────────────────────
  function setSaveStatus(status) {
    const el = document.getElementById('save-status');
    el.className = 'save-status ' + status;
    el.textContent = { saved: '保存済', unsaved: '未保存', saving: '保存中...' }[status] || '';
    isDirty = (status === 'unsaved');
  }

  function markUnsaved() {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(performSave, 1500);
  }

  function performSave() {
    if (!currentId) {
      showToast('先にプロジェクトを選んでください');
      return;
    }
    const p = currentProject();
    if (p) saveHistorySnapshot('保存前', { html: p.html, css: p.css, js: p.js });
    setSaveStatus('saving');
    captureEditors();
    persistProjects();
    setTimeout(() => setSaveStatus('saved'), 200);
  }

  // ── Project title display ──────────────────────
  function refreshTitle() {
    const p = currentProject();
    document.getElementById('project-title').textContent = p ? p.title : 'プロジェクトなし';
  }

  // ── Guard: show when no project selected ────
  function updateGuardState() {
    const guard = document.getElementById('no-project-guard');
    if (currentId) {
      guard.classList.add('hidden');
    } else {
      guard.classList.remove('hidden');
    }
  }

  // ── Fullscreen preview ───────────────────────────
  function exitFullscreen() {
    const pane = document.getElementById('pane-preview');
    if (!pane.classList.contains('is-fullscreen')) return;
    pane.classList.remove('is-fullscreen');
    document.getElementById('btn-fullscreen-preview').textContent = '全画面';
  }

  function toggleFullscreen() {
    const pane = document.getElementById('pane-preview');
    if (pane.classList.contains('is-fullscreen')) {
      exitFullscreen();
    } else {
      pane.classList.add('is-fullscreen');
      document.getElementById('btn-fullscreen-preview').textContent = '✕ 閉じる';
      refreshPreview();
    }
  }

  // ── Select project ────────────────────────────
  function selectProject(id) {
    if (isDirty && currentId) performSave();
    currentId = id;
    loadIntoEditors(currentProject());
    refreshTitle();
    updateGuardState();
    setSaveStatus('saved');
    persistProjects();
    closeAllModals();
    switchTab('html');
  }

  // ── Tabs ──────────────────────────────────────────
  function switchTab(tab) {
    if (tab !== 'preview') exitFullscreen();
    document.querySelectorAll('.tab').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === tab)
    );
    document.querySelectorAll('.pane').forEach(pane =>
      pane.classList.toggle('active', pane.id === 'pane-' + tab)
    );
    if (tab === 'preview') refreshPreview();
  }

  // ── Preview ─────────────────────────────────────
  function buildPreviewDoc() {
    const html   = editorVal('html');
    const css    = editorVal('css');
    const js     = editorVal('js');
    const safeJs = js.replace(/<\/script>/gi, '<\/script>');
    const previewTouchStyle =
      '<style id="mobile-code-desk-preview-touch-style">\n' +
      '*, *::before, *::after { -webkit-tap-highlight-color: transparent; }\n' +
      'button, a, [role="button"], svg, svg * { touch-action: manipulation; }\n' +
      'svg, svg * { -webkit-user-select: none; user-select: none; }\n' +
      'input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; touch-action: auto; }\n' +
      '</style>';
    const consoleInterceptor =
      '<script id="mcd-ci">(function(){' +
      'var _post=function(lv,args){' +
        'var txt=Array.prototype.slice.call(args).map(function(a){' +
          'if(a===null)return"null";' +
          'if(a===undefined)return"undefined";' +
          'if(typeof a==="object"||typeof a==="function"){try{return JSON.stringify(a);}catch(e){return String(a);}}' +
          'return String(a);' +
        '}).join(" ");' +
        'try{window.parent.postMessage({type:"mcd-log",level:lv,text:txt},"*");}catch(_){}' +
      '};' +
      'var _c=window.console;' +
      'window.console={' +
        'log:function(){_post("log",arguments);_c.log&&_c.log.apply(_c,arguments);},'+
        'info:function(){_post("log",arguments);_c.info&&_c.info.apply(_c,arguments);},'+
        'warn:function(){_post("warn",arguments);_c.warn&&_c.warn.apply(_c,arguments);},'+
        'error:function(){_post("error",arguments);_c.error&&_c.error.apply(_c,arguments);}'+
      '};'+
      'window.onerror=function(msg,src,line,col,err){'+
        '_post("error",["[エラー] "+msg+" (行 "+line+")"]);'+
      '};'+
      'window.addEventListener("unhandledrejection",function(e){'+
        'var r=e.reason;'+
        '_post("error",["[Promise] "+(r instanceof Error?r.message:String(r))]);'+
      '});'+
      '})();<\/script>';
    return [
      '<!DOCTYPE html><html lang="ja"><head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      consoleInterceptor,
      previewTouchStyle,
      '<style>', css, '</style>',
      '</head><body>',
      html,
      '<script>', safeJs, '<\/script>',
      '</body></html>'
    ].join('\n');
  }

  function refreshPreview() {
    if (currentId) {
      const added = saveHistorySnapshot('プレビュー前', { html: editorVal('html'), css: editorVal('css'), js: editorVal('js') });
      if (added) persistProjects();
    }
    clearConsoleLogs();
    const iframe = document.getElementById('preview-frame');
    iframe.srcdoc = '';
    requestAnimationFrame(() => {
      iframe.srcdoc = buildPreviewDoc();
    });
  }

  // ── Copy ─────────────────────────────────────────
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        showToast('コピーしました');
        return;
      } catch (_) { /* fall through to manual fallback */ }
    }
    openCopyFallback(text);
  }

  function openCopyFallback(text) {
    const ta = document.getElementById('copy-fallback-textarea');
    ta.value = text;
    openModal('modal-copy-fallback');
    setTimeout(() => { ta.focus(); ta.select(); }, 150);
  }

  // ── Toast ─────────────────────────────────────────
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ── Modals ───────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (!document.querySelector('.modal:not(.hidden)')) {
      document.body.classList.remove('modal-open');
    }
  }

  function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.body.classList.remove('modal-open');
  }

  // ── Project list UI ───────────────────────────
  function renderProjectList() {
    const list = document.getElementById('project-list');
    list.innerHTML = '';

    if (projects.length === 0) {
      list.innerHTML = '<li class="no-projects">プロジェクトがありません</li>';
      return;
    }

    // Newest first
    [...projects].reverse().forEach(p => {
      const li = document.createElement('li');
      li.className = 'project-item' + (p.id === currentId ? ' active' : '');

      const sel = document.createElement('button');
      sel.className   = 'project-select';
      sel.dataset.id  = p.id;
      sel.textContent = p.title;

      const actions = document.createElement('div');
      actions.className = 'project-actions';

      const ren = document.createElement('button');
      ren.className        = 'project-rename';
      ren.dataset.id       = p.id;
      ren.setAttribute('aria-label', '名前を変更');
      ren.textContent      = '✎';

      const del = document.createElement('button');
      del.className        = 'project-delete';
      del.dataset.id       = p.id;
      del.setAttribute('aria-label', '削除');
      del.textContent      = '🗑';

      actions.append(ren, del);
      li.append(sel, actions);
      list.appendChild(li);
    });
  }

  // ── Export ──────────────────────────────────────────
  function exportAll() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadText(
      'mcd-export-' + date + '.json',
      JSON.stringify(projects, null, 2),
      'application/json'
    );
  }

  // ── Import ──────────────────────────────────────────
  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (_) {
        showToast('ファイルの読み込みに失敗しました');
        return;
      }

      if (!Array.isArray(parsed)) {
        showToast('データの形式が正しくありません');
        return;
      }

      const valid = parsed.every(p =>
        p && typeof p === 'object' &&
        typeof p.id    === 'string' &&
        typeof p.title === 'string' &&
        typeof p.html  === 'string' &&
        typeof p.css   === 'string' &&
        typeof p.js    === 'string'
      );
      if (!valid) {
        showToast('データの項目が不足しています');
        return;
      }

      showConfirm(
        parsed.length + '件のプロジェクトで上書きします。現在のデータはすべて失われます。よろしいですか？',
        () => {
          projects  = parsed;
          currentId = projects.length > 0 ? projects[projects.length - 1].id : null;
          loadIntoEditors(currentProject());
          refreshTitle();
          updateGuardState();
          persistProjects();
          setSaveStatus('saved');
          showToast('読み込みました');
        }
      );
    };
    reader.readAsText(file);
  }

  // ── 1-file HTML ──────────────────────────────
  function buildSingleHtml() {
    const p     = currentProject();
    const title = p ? escAttr(p.title) : 'untitled';

    return '<!DOCTYPE html>\n' +
      '<html lang="ja">\n' +
      '<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + title + '</title>\n' +
      '  <style>\n' +
      editorVal('css') + '\n' +
      '  </style>\n' +
      '</head>\n' +
      '<body>\n' +
      editorVal('html') + '\n' +
      '  <script>\n' +
      editorVal('js') + '\n' +
      '  <\/script>\n' +
      '</body>\n' +
      '</html>';
  }

  function escAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── File download helper ────────────────────────
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Duplicate project ────────────────────────────
  function duplicateProject() {
    if (!currentId) { showToast('先にプロジェクトを選んでください'); return; }
    const src  = currentProject();
    if (!src) return;
    const copy = buildProject(src.title + ' のコピー');
    copy.html  = editorVal('html');
    copy.css   = editorVal('css');
    copy.js    = editorVal('js');
    projects.push(copy);
    persistProjects();
    selectProject(copy.id);
    showToast('コピーを作りました');
  }

  // ── AI Help: build consultation text ────────────────
  function buildAiHelpText() {
    const expected  = document.getElementById('ai-expected-input').value.trim();
    const actual    = document.getElementById('ai-actual-input').value.trim();
    const memo      = document.getElementById('ai-memo-input').value.trim();
    const inclHtml  = document.getElementById('ai-incl-html').checked;
    const inclCss   = document.getElementById('ai-incl-css').checked;
    const inclJs    = document.getElementById('ai-incl-js').checked;
    const inclLog   = document.getElementById('ai-incl-log').checked;
    const formatSel = document.querySelector('input[name="ai-format"]:checked');
    const isPatch   = formatSel && formatSel.value === 'patch';

    const p           = currentProject();
    const projectName = p ? p.title : '（プロジェクト未選択）';

    const lines = [
      'コードについて相談があります。',
      '',
      'プロジェクト名：' + projectName,
      '',
      '期待する動き：' + (expected || '（未入力）'),
      '実際の状態：'   + (actual   || '（未入力）'),
      '追加メモ：'     + (memo     || '（なし）'),
    ];

    if (inclHtml) {
      lines.push('', '--- HTML ---', editorVal('html').trim() || '（なし）');
    }
    if (inclCss) {
      lines.push('', '--- CSS ---', editorVal('css').trim() || '（なし）');
    }
    if (inclJs) {
      lines.push('', '--- JavaScript ---', editorVal('js').trim() || '（なし）');
    }
    if (inclLog && consoleLogs.length > 0) {
      const logText = consoleLogs
        .map(l => '[' + l.level.toUpperCase() + '] ' + l.text)
        .join('\n');
      lines.push('', '--- コンソールログ ---', logText);
    }

    if (isPatch) {
      lines.push(
        '',
        '--- 返答形式の指定 ---',
        'JSONのみ返してください（挨拶・解説は不要）。',
        '',
        '・CodeDeskのJSONパッチ形式（配列）で返す',
        '・target: "html" / "css" / "js" のいずれか',
        '・mode: "replace" / "insertBefore" / "insertAfter" のいずれか',
        '・find: 現在のコード内に1回だけ出てくる文字列にする',
        '・replace: 置き換え後の文字列（mode が "replace" のとき）',
        '・insert: 挿入する文字列（mode が "insertBefore" または "insertAfter" のとき）'
      );
    }

    return lines.join('\n');
  }

  // ── Confirm modal ───────────────────────────
  function showConfirm(msg, cb) {
    document.getElementById('confirm-message').textContent = msg;
    confirmCallback = cb;
    openModal('modal-confirm');
  }

  // ── Patch Check ──────────────────────────────
  function parsePatchJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch (e) {
      return { ok: false, error: 'JSONの形式が正しくありません：\n' + e.message };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'JSONは配列 [ ... ] の形式にしてください' };
    }
    if (parsed.length === 0) {
      return { ok: false, error: 'パッチが1件もありません' };
    }

    const VALID_TARGETS = ['html', 'css', 'js'];
    const VALID_MODES   = ['replace', 'insertBefore', 'insertAfter'];
    const errors = [];

    parsed.forEach((patch, i) => {
      const n = i + 1;
      if (!patch || typeof patch !== 'object') {
        errors.push(n + '件目：パッチの形式が正しくありません');
        return;
      }
      if (!VALID_TARGETS.includes(patch.target)) {
        errors.push(n + '件目：target は html / css / js のいずれかにしてください（現在：' + JSON.stringify(patch.target) + '）');
      }
      if (!VALID_MODES.includes(patch.mode)) {
        errors.push(n + '件目：mode は replace / insertBefore / insertAfter のいずれかにしてください（現在：' + JSON.stringify(patch.mode) + '）');
      }
      if (typeof patch.find !== 'string' || patch.find === '') {
        errors.push(n + '件目：find が空か指定されていません');
      }
      if (patch.mode === 'replace') {
        if (typeof patch.replace !== 'string') {
          errors.push(n + '件目：replace が指定されていません（mode が replace のとき必要です）');
        }
      } else if (patch.mode === 'insertBefore' || patch.mode === 'insertAfter') {
        if (typeof patch.insert !== 'string' || patch.insert === '') {
          errors.push(n + '件目：insert が空か指定されていません（mode が ' + patch.mode + ' のとき必要です）');
        }
      }
    });

    if (errors.length > 0) {
      return { ok: false, error: errors.join('\n') };
    }
    return { ok: true, patches: parsed };
  }

  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let pos   = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
      count++;
      pos += needle.length;
    }
    return count;
  }

  function safeStringReplace(haystack, needle, replacement) {
    const idx = haystack.indexOf(needle);
    if (idx === -1) return haystack;
    return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
  }

  function runPatchCheck() {
    if (!currentId) {
      showToast('先にプロジェクトを選んでください');
      return;
    }

    const jsonText  = document.getElementById('patch-json-input').value.trim();
    const resultsEl = document.getElementById('patch-results-area');
    const resetBtn  = document.getElementById('btn-patch-reset');
    const applyBtn  = document.getElementById('btn-apply-patch-copy');

    if (!jsonText) {
      showToast('JSONを貼り付けてください');
      return;
    }

    const parseResult = parsePatchJson(jsonText);

    if (!parseResult.ok) {
      resultsEl.innerHTML = '<div class="patch-parse-error">' + escHtml(parseResult.error) + '</div>';
      resultsEl.classList.remove('hidden');
      resetBtn.classList.remove('hidden');
      applyBtn.classList.add('hidden');
      return;
    }

    const sources = {
      html: editorVal('html'),
      css:  editorVal('css'),
      js:   editorVal('js')
    };
    const targetLabel = { html: 'HTML', css: 'CSS', js: 'JavaScript' };
    const modeLabel   = { replace: '置き換え', insertBefore: '前に挿入', insertAfter: '後ろに挿入' };

    let hasError  = false;
    let itemsHtml = '';

    parseResult.patches.forEach((patch, i) => {
      const source = sources[patch.target];
      const count  = countOccurrences(source, patch.find);
      const header = 'パッチ ' + (i + 1) + ' / ' + parseResult.patches.length +
                     '　' + targetLabel[patch.target] + '　' + modeLabel[patch.mode];

      itemsHtml += '<div class="patch-item">';
      itemsHtml += '<div class="patch-item-header">' + escHtml(header) + '</div>';

      if (count === 0) {
        hasError = true;
        itemsHtml += '<div class="patch-status patch-status-error">✕ 見つかりませんでした</div>';
        itemsHtml += '<div class="patch-field-label">探した文字列</div>';
        itemsHtml += '<pre class="patch-code patch-code-find">' + escHtml(patch.find) + '</pre>';

      } else if (count > 1) {
        hasError = true;
        itemsHtml += '<div class="patch-status patch-status-error">✕ ' + count + '箇所で見つかりました（一意でないため確認できません）</div>';
        itemsHtml += '<div class="patch-field-label">探した文字列</div>';
        itemsHtml += '<pre class="patch-code patch-code-find">' + escHtml(patch.find) + '</pre>';

      } else {
        itemsHtml += '<div class="patch-status patch-status-ok">✓ 1箇所で見つかりました</div>';

        if (patch.mode === 'replace') {
          itemsHtml += '<div class="patch-field-label">変更前</div>';
          itemsHtml += '<pre class="patch-code patch-code-before">' + escHtml(patch.find) + '</pre>';
          itemsHtml += '<div class="patch-field-label">変更後</div>';
          itemsHtml += '<pre class="patch-code patch-code-after">' + escHtml(patch.replace) + '</pre>';

        } else if (patch.mode === 'insertBefore') {
          itemsHtml += '<div class="patch-field-label">挿入位置（この行の前）</div>';
          itemsHtml += '<pre class="patch-code patch-code-find">' + escHtml(patch.find) + '</pre>';
          itemsHtml += '<div class="patch-field-label">挿入する内容</div>';
          itemsHtml += '<pre class="patch-code patch-code-after">' + escHtml(patch.insert) + '</pre>';

        } else {
          itemsHtml += '<div class="patch-field-label">挿入位置（この行の後）</div>';
          itemsHtml += '<pre class="patch-code patch-code-find">' + escHtml(patch.find) + '</pre>';
          itemsHtml += '<div class="patch-field-label">挿入する内容</div>';
          itemsHtml += '<pre class="patch-code patch-code-after">' + escHtml(patch.insert) + '</pre>';
        }
      }

      itemsHtml += '</div>';
    });

    const summary = hasError
      ? '<div class="patch-summary patch-summary-error">エラーがあります。AIにfindの文字列を確認・修正してもらってください。</div>'
      : '<div class="patch-summary patch-summary-ok">すべてのパッチが1箇所で見つかりました。このコードに安全に適用できる見込みです。</div>';

    resultsEl.innerHTML = summary + itemsHtml;
    resultsEl.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    applyBtn.classList.toggle('hidden', hasError);

    setTimeout(() => resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // ── Patch Apply (copy) ───────────────────────────
  function applyPatchesToCopy() {
    if (!currentId) {
      showToast('先にプロジェクトを選んでください');
      return;
    }

    const jsonText    = document.getElementById('patch-json-input').value.trim();
    const parseResult = parsePatchJson(jsonText);
    if (!parseResult.ok) {
      showToast('パッチの内容を再確認してください');
      return;
    }

    const sources = {
      html: editorVal('html'),
      css:  editorVal('css'),
      js:   editorVal('js')
    };

    for (const patch of parseResult.patches) {
      if (countOccurrences(sources[patch.target], patch.find) !== 1) {
        showToast('コードが変更されています。もう一度「確認する」を実行してください');
        return;
      }
    }

    for (const patch of parseResult.patches) {
      if (patch.mode === 'replace') {
        sources[patch.target] = safeStringReplace(sources[patch.target], patch.find, patch.replace);
      } else if (patch.mode === 'insertBefore') {
        sources[patch.target] = safeStringReplace(sources[patch.target], patch.find, patch.insert + patch.find);
      } else if (patch.mode === 'insertAfter') {
        sources[patch.target] = safeStringReplace(sources[patch.target], patch.find, patch.find + patch.insert);
      }
    }

    const src  = currentProject();
    const copy = buildProject(src.title + ' のコピー');
    copy.html  = sources.html;
    copy.css   = sources.css;
    copy.js    = sources.js;

    projects.push(copy);
    persistProjects();
    closeAllModals();
    selectProject(copy.id);
    showToast('コピーに修正を適用しました');
  }

  // ── Code Lint ────────────────────────────────────
  function checkHtml(code) {
    if (!code.trim()) return null;
    const issues = [];

    const openAngle  = (code.match(/</g)  || []).length;
    const closeAngle = (code.match(/>/g) || []).length;
    if (openAngle > closeAngle) {
      issues.push('< が ' + openAngle + ' 個、> が ' + closeAngle + ' 個（タグが途中で切れている可能性）');
    }

    const pairedTags = ['div', 'script', 'style', 'form', 'ul', 'ol', 'select', 'table'];
    for (const tag of pairedTags) {
      const opens  = (code.match(new RegExp('<' + tag + '[\\s>/]', 'gi')) || []).length;
      const closes = (code.match(new RegExp('<\\/' + tag + '\\s*>', 'gi')) || []).length;
      if (opens !== closes) {
        issues.push('&lt;' + tag + '&gt; の開閉が合いません（開く：' + opens + '、閉じる：' + closes + '）');
      }
    }

    return issues.length > 0 ? issues : null;
  }

  function checkCss(code) {
    if (!code.trim()) return null;
    const issues = [];

    const opens  = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    if (opens !== closes) {
      issues.push('{ と } の数が合いません（{ が ' + opens + ' 個、} が ' + closes + ' 個）');
    }

    const commentOpens  = (code.match(/\/\*/g) || []).length;
    const commentCloses = (code.match(/\*\//g) || []).length;
    if (commentOpens !== commentCloses) {
      issues.push('/* コメントが閉じていない可能性があります');
    }

    return issues.length > 0 ? issues : null;
  }

  function checkJs(code) {
    if (!code.trim()) return null;
    try {
      new Function(code);
      return null;
    } catch (e) {
      if (!(e instanceof SyntaxError)) return null;
      return ['構文エラー：' + e.message];
    }
  }

  function lintEditor(type) {
    const banner  = document.getElementById('warn-' + type);
    const tabWarn = document.querySelector('[data-tab="' + type + '"] .tab-warn');
    if (!banner) return;

    let issues = null;
    try {
      const code  = editorVal(type);
      const check = type === 'html' ? checkHtml : type === 'css' ? checkCss : checkJs;
      issues = check(code);
    } catch (_) {
      issues = null;
    }

    if (issues && issues.length > 0) {
      banner.innerHTML = issues.map(s => '<span class="warn-item">&#9888; ' + s + '</span>').join('');
      banner.classList.remove('hidden');
      if (tabWarn) tabWarn.classList.remove('hidden');
    } else {
      banner.innerHTML = '';
      banner.classList.add('hidden');
      if (tabWarn) tabWarn.classList.add('hidden');
    }
  }

  function lintAll() {
    ['html', 'css', 'js'].forEach(lintEditor);
  }

  function debounceLint(type) {
    clearTimeout(lintTimers[type]);
    lintTimers[type] = setTimeout(() => lintEditor(type), 800);
  }

  // ── Console Panel ────────────────────────────────
  function appendConsoleLog(level, text) {
    consoleLogs.push({ level: level, text: text });
    const list = document.getElementById('console-log-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'console-item console-item-' + level;
    item.textContent = text;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
    updateConsoleBadge();
  }

  function clearConsoleLogs() {
    consoleLogs = [];
    const list = document.getElementById('console-log-list');
    if (list) list.innerHTML = '';
    updateConsoleBadge();
  }

  function updateConsoleBadge() {
    const btn = document.getElementById('btn-toggle-console');
    if (!btn) return;
    const panel    = document.getElementById('console-panel');
    const isOpen   = panel && !panel.classList.contains('hidden');
    const errCount = consoleLogs.filter(l => l.level === 'error').length;
    btn.textContent = isOpen ? 'コンソール ▲' : 'コンソール ▼';
    btn.classList.toggle('console-btn-error', errCount > 0);
  }

  function toggleConsole() {
    const panel = document.getElementById('console-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    updateConsoleBadge();
  }

  function copyConsoleLogs() {
    const text = consoleLogs
      .map(l => '[' + l.level.toUpperCase() + '] ' + l.text)
      .join('\n');
    copyText(text || '（コンソールなし）');
  }

  // ── History UI ───────────────────────────────────────
  function formatHistoryDate(isoStr) {
    const d   = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderHistoryList() {
    const p    = currentProject();
    const list = document.getElementById('history-list');
    if (!list) return;
    if (!p || !Array.isArray(p.history) || p.history.length === 0) {
      list.innerHTML = '<li class="no-history">履歴がありません</li>';
      return;
    }
    list.innerHTML = '';
    [...p.history].reverse().forEach(entry => {
      const li   = document.createElement('li');
      li.className = 'history-item';
      const meta = document.createElement('div');
      meta.className = 'history-item-meta';
      const time = document.createElement('span');
      time.className   = 'history-item-time';
      time.textContent = formatHistoryDate(entry.savedAt);
      const lbl  = document.createElement('span');
      lbl.className   = 'history-item-reason';
      lbl.textContent = entry.reason;
      meta.append(time, lbl);
      const btn  = document.createElement('button');
      btn.className   = 'btn-restore';
      btn.textContent = '復元';
      btn.addEventListener('click', () => {
        closeModal('modal-history');
        restoreFromHistory(entry);
      });
      li.append(meta, btn);
      list.appendChild(li);
    });
  }

  function openHistoryModal() {
    if (!currentId) { showToast('先にプロジェクトを選んでください'); return; }
    renderHistoryList();
    openModal('modal-history');
  }

  function restoreFromHistory(entry) {
    showConfirm(
      '現在のHTML/CSS/JavaScriptを、この履歴の状態に戻します。よろしいですか？',
      () => {
        document.getElementById('editor-html').value = entry.html;
        document.getElementById('editor-css').value  = entry.css;
        document.getElementById('editor-js').value   = entry.js;
        lintAll();
        markUnsaved();
        showToast('履歴を復元しました');
      }
    );
  }

  // ── Init & event wiring ──────────────────────────
  function init() {
    loadFromStorage();

    const lastId = localStorage.getItem(LAST_ID_KEY);
    if (lastId && findProject(lastId)) {
      currentId = lastId;
    } else if (projects.length > 0) {
      currentId = projects[projects.length - 1].id;
    }

    loadIntoEditors(currentProject());
    refreshTitle();
    setSaveStatus('saved');
    updateGuardState();

    // ── Tabs ──
    document.querySelectorAll('.tab').forEach(btn =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    // ── Editors: auto-save + lint on input ──
    ['html', 'css', 'js'].forEach(t =>
      document.getElementById('editor-' + t).addEventListener('input', () => {
        markUnsaved();
        debounceLint(t);
      })
    );

    // ── Manual save button ──
    document.getElementById('btn-save').addEventListener('click', () => {
      clearTimeout(saveTimer);
      performSave();
    });

    // ── Guard buttons ──
    document.getElementById('btn-guard-create').addEventListener('click', () => {
      document.getElementById('new-project-input').value = '';
      openModal('modal-new-project');
      setTimeout(() => document.getElementById('new-project-input').focus(), 150);
    });
    document.getElementById('btn-guard-list').addEventListener('click', () => {
      renderProjectList();
      openModal('modal-projects');
    });

    // ── Fullscreen preview ──
    document.getElementById('btn-fullscreen-preview').addEventListener('click', toggleFullscreen);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') exitFullscreen();
    });

    // ── Project menu ──
    document.getElementById('btn-project-menu').addEventListener('click', () => {
      renderProjectList();
      openModal('modal-projects');
    });

    // ── Open new-project modal ──
    document.getElementById('btn-open-new-project').addEventListener('click', () => {
      document.getElementById('new-project-input').value = '';
      openModal('modal-new-project');
      setTimeout(() => document.getElementById('new-project-input').focus(), 150);
    });

    // ── Create project ──
    document.getElementById('btn-create-project').addEventListener('click', () => {
      const title = document.getElementById('new-project-input').value.trim() || '新規プロジェクト';
      const p = buildProject(title);
      projects.push(p);
      persistProjects();
      selectProject(p.id);
    });
    document.getElementById('new-project-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-create-project').click();
    });

    // ── Project list: event delegation ──
    document.getElementById('project-list').addEventListener('click', e => {
      const sel = e.target.closest('.project-select');
      const ren = e.target.closest('.project-rename');
      const del = e.target.closest('.project-delete');

      if (sel) {
        selectProject(sel.dataset.id);

      } else if (ren) {
        renameTargetId = ren.dataset.id;
        const p = findProject(renameTargetId);
        if (!p) return;
        document.getElementById('rename-input').value = p.title;
        closeModal('modal-projects');
        openModal('modal-rename');
        setTimeout(() => document.getElementById('rename-input').focus(), 150);

      } else if (del) {
        const id = del.dataset.id;
        const p  = findProject(id);
        if (!p) return;
        showConfirm(
          '「' + p.title + '」を削除します。この操作は取り消せません。',
          () => {
            projects = projects.filter(q => q.id !== id);
            if (currentId === id) {
              currentId = projects.length > 0 ? projects[projects.length - 1].id : null;
              loadIntoEditors(currentProject());
              refreshTitle();
              updateGuardState();
              setSaveStatus('saved');
            }
            persistProjects();
            renderProjectList();
            showToast('削除しました');
          }
        );
      }
    });

    // ── Preview refresh ──
    document.getElementById('btn-refresh-preview').addEventListener('click', refreshPreview);

    // ── Console Panel ──
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.type !== 'mcd-log') return;
      const iframe = document.getElementById('preview-frame');
      if (!iframe || e.source !== iframe.contentWindow) return;
      appendConsoleLog(String(e.data.level || 'log'), String(e.data.text || ''));
    });
    document.getElementById('btn-toggle-console').addEventListener('click', toggleConsole);
    document.getElementById('btn-clear-console').addEventListener('click', clearConsoleLogs);
    document.getElementById('btn-copy-console').addEventListener('click', copyConsoleLogs);

    // ── History ──
    document.getElementById('btn-open-history').addEventListener('click', () => {
      closeAllModals();
      openHistoryModal();
    });
    document.getElementById('btn-save-manual-history').addEventListener('click', () => {
      if (!currentId) return;
      const added = saveHistorySnapshot('手動バックアップ', { html: editorVal('html'), css: editorVal('css'), js: editorVal('js') });
      if (added) {
        persistProjects();
        renderHistoryList();
        showToast('バックアップを保存しました');
      } else {
        showToast('変更がないためスキップしました');
      }
    });

    // ── Copy buttons (per tab) ──
    document.querySelectorAll('.btn-copy').forEach(btn =>
      btn.addEventListener('click', () => copyText(editorVal(btn.dataset.target)))
    );

    // ── Copy fallback: select all ──
    document.getElementById('btn-select-all-fallback').addEventListener('click', () => {
      const ta = document.getElementById('copy-fallback-textarea');
      ta.focus();
      ta.select();
    });

    // ── Export ──
    document.getElementById('btn-export').addEventListener('click', exportAll);

    // ── Import ──
    document.getElementById('import-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { importFromFile(file); e.target.value = ''; }
    });

    // ── 1-file HTML ──
    document.getElementById('btn-single-html').addEventListener('click', () => {
      if (!currentId) { showToast('先にプロジェクトを選んでください'); return; }
      document.getElementById('single-html-textarea').value = buildSingleHtml();
      openModal('modal-single-html');
    });

    document.getElementById('btn-copy-single-html').addEventListener('click', () =>
      copyText(document.getElementById('single-html-textarea').value)
    );

    document.getElementById('btn-download-single-html').addEventListener('click', () => {
      const p        = currentProject();
      const safeName = p
        ? p.title.replace(/[^\w぀-ヿ一-鿿\-]/g, '_').slice(0, 60)
        : 'untitled';
      downloadText(
        safeName + '.html',
        document.getElementById('single-html-textarea').value,
        'text/html'
      );
    });

    // ── Duplicate project ──
    document.getElementById('btn-duplicate').addEventListener('click', duplicateProject);

    // ── Rename ──
    document.getElementById('btn-rename-ok').addEventListener('click', () => {
      const title = document.getElementById('rename-input').value.trim();
      if (!title) { showToast('プロジェクト名を入力してください'); return; }
      const p = findProject(renameTargetId);
      if (p) {
        p.title     = title;
        p.updatedAt = new Date().toISOString();
        persistProjects();
        if (renameTargetId === currentId) refreshTitle();
        showToast('名前を変更しました');
      }
      closeModal('modal-rename');
      renameTargetId = null;
    });
    document.getElementById('rename-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-rename-ok').click();
    });

    // ── Confirm modal ──
    document.getElementById('btn-confirm-ok').addEventListener('click', () => {
      closeModal('modal-confirm');
      if (confirmCallback) { confirmCallback(); confirmCallback = null; }
    });
    document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
      closeModal('modal-confirm');
      confirmCallback = null;
    });

    // ── AI Help ──
    document.getElementById('btn-ai-help').addEventListener('click', () => {
      document.getElementById('ai-expected-input').value = '';
      document.getElementById('ai-actual-input').value = '';
      document.getElementById('ai-memo-input').value = '';
      document.getElementById('ai-incl-html').checked = !!editorVal('html').trim();
      document.getElementById('ai-incl-css').checked  = !!editorVal('css').trim();
      document.getElementById('ai-incl-js').checked   = !!editorVal('js').trim();
      const logBox = document.getElementById('ai-incl-log');
      logBox.disabled = consoleLogs.length === 0;
      logBox.checked  = consoleLogs.length > 0;
      const firstFormat = document.querySelector('input[name="ai-format"]');
      if (firstFormat) firstFormat.checked = true;
      document.getElementById('ai-result-textarea').value = '';
      document.getElementById('ai-result-area').classList.add('hidden');
      openModal('modal-ai-help');
    });

    document.getElementById('btn-generate-ai-text').addEventListener('click', () => {
      const text = buildAiHelpText();
      if (!text) return;
      document.getElementById('ai-result-textarea').value = text;
      document.getElementById('ai-result-area').classList.remove('hidden');
      const body = document.querySelector('#modal-ai-help .modal-body');
      if (body) setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
    });

    document.getElementById('btn-copy-ai-text').addEventListener('click', () => {
      copyText(document.getElementById('ai-result-textarea').value);
    });

    // ── Patch Check ──
    document.getElementById('btn-patch-check').addEventListener('click', () => {
      document.getElementById('patch-json-input').value = '';
      document.getElementById('patch-results-area').innerHTML = '';
      document.getElementById('patch-results-area').classList.add('hidden');
      document.getElementById('btn-apply-patch-copy').classList.add('hidden');
      document.getElementById('btn-patch-reset').classList.add('hidden');
      openModal('modal-patch-check');
    });

    document.getElementById('btn-run-patch-check').addEventListener('click', runPatchCheck);

    document.getElementById('btn-apply-patch-copy').addEventListener('click', applyPatchesToCopy);

    document.getElementById('btn-patch-reset').addEventListener('click', () => {
      document.getElementById('patch-results-area').innerHTML = '';
      document.getElementById('patch-results-area').classList.add('hidden');
      document.getElementById('btn-apply-patch-copy').classList.add('hidden');
      document.getElementById('btn-patch-reset').classList.add('hidden');
    });

    // ── Generic close buttons ──
    document.querySelectorAll('.btn-close').forEach(btn =>
      btn.addEventListener('click', () => closeModal(btn.dataset.modal))
    );

    // ── Close modals on backdrop tap ──
    document.querySelectorAll('.modal').forEach(modal =>
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal(modal.id);
      })
    );
  }

  document.addEventListener('DOMContentLoaded', init);
})();
