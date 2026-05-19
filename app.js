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

  // ── ID generation ──────────────────────────────
  function genId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  // ── Storage ────────────────────────────────
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
    } catch (_) {
      showToast('保存できませんでした');
    }
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

  // ── Tabs ──────────────────────────────────────
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

  // ── Preview ───────────────────────────────────
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
    return [
      '<!DOCTYPE html><html lang="ja"><head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      previewTouchStyle,
      '<style>', css, '</style>',
      '</head><body>',
      html,
      '<script>', safeJs, '<\/script>',
      '</body></html>'
    ].join('\n');
  }

  function refreshPreview() {
    const iframe = document.getElementById('preview-frame');
    iframe.srcdoc = '';
    requestAnimationFrame(() => {
      iframe.srcdoc = buildPreviewDoc();
    });
  }

  // ── Copy ───────────────────────────────────────
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

  // ── Toast ───────────────────────────────────────
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

  // ── Export ──────────────────────────────────────
  function exportAll() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadText(
      'mcd-export-' + date + '.json',
      JSON.stringify(projects, null, 2),
      'application/json'
    );
  }

  // ── Import ──────────────────────────────────────
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

  // ── Duplicate project ──────────────────────────
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

  // ── AI Help: build consultation text ────────────
  function buildAiHelpText() {
    const problem  = document.querySelector('input[name="ai-problem"]:checked');
    const request  = document.querySelector('input[name="ai-request"]:checked');
    const expected = document.getElementById('ai-expected-input').value.trim();
    const actual   = document.getElementById('ai-actual-input').value.trim();
    const memo     = document.getElementById('ai-memo-input').value.trim();

    if (!problem) { showToast('困っていることを選んでください'); return null; }
    if (!request) { showToast('AIにお願いしたいことを選んでください'); return null; }

    const p           = currentProject();
    const projectName = p ? p.title : '（プロジェクト未選択）';

    const activeTab = document.querySelector('.tab.active');
    const tabKey    = activeTab ? activeTab.dataset.tab : '';
    const tabLabel  = {
      html:    '画面（HTML）',
      css:     '見た目（CSS）',
      js:      '動き（JavaScript）',
      preview: 'ためす（プレビュー）'
    }[tabKey] || tabKey;

    const html = editorVal('html').trim() || '（なし）';
    const css  = editorVal('css').trim()  || '（なし）';
    const js   = editorVal('js').trim()   || '（なし）';

    const lines = [
      '以下のコードについて相談があります。',
      '',
      'プロジェクト名：' + projectName,
      '作業中のタブ：'   + tabLabel,
      '',
      '困っていること：'       + problem.value,
      'AIにお願いしたいこと：' + request.value,
      '',
      '期待する動き：' + (expected || '（未入力）'),
      '実際の状態：'   + (actual   || '（未入力）'),
      '追加メモ：'     + (memo     || '（なし）'),
      '',
      '--- HTML ---',
      html,
      '',
      '--- CSS ---',
      css,
      '',
      '--- JavaScript ---',
      js
    ];

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

  function runPatchCheck() {
    if (!currentId) {
      showToast('先にプロジェクトを選んでください');
      return;
    }

    const jsonText  = document.getElementById('patch-json-input').value.trim();
    const resultsEl = document.getElementById('patch-results-area');
    const resetBtn  = document.getElementById('btn-patch-reset');

    if (!jsonText) {
      showToast('JSONを貼り付けてください');
      return;
    }

    const parseResult = parsePatchJson(jsonText);

    if (!parseResult.ok) {
      resultsEl.innerHTML = '<div class="patch-parse-error">' + escHtml(parseResult.error) + '</div>';
      resultsEl.classList.remove('hidden');
      resetBtn.classList.remove('hidden');
      return;
    }

    const sources = {
      html: editorVal('html'),
      css:  editorVal('css'),
      js:   editorVal('js')
    };
    const targetLabel = { html: 'HTML', css: 'CSS', js: 'JavaScript' };
    const modeLabel   = { replace: '置き換え', insertBefore: '前に挿入', insertAfter: '後に挿入' };

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

    setTimeout(() => resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // ── Init & event wiring ──────────────────────
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

    // ── Editors: auto-save on input ──
    ['html', 'css', 'js'].forEach(t =>
      document.getElementById('editor-' + t).addEventListener('input', markUnsaved)
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
      document.querySelectorAll('input[name="ai-problem"], input[name="ai-request"]').forEach(r => {
        r.checked = false;
      });
      document.getElementById('ai-expected-input').value = '';
      document.getElementById('ai-actual-input').value = '';
      document.getElementById('ai-memo-input').value = '';
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
      document.getElementById('btn-patch-reset').classList.add('hidden');
      openModal('modal-patch-check');
    });

    document.getElementById('btn-run-patch-check').addEventListener('click', runPatchCheck);

    document.getElementById('btn-patch-reset').addEventListener('click', () => {
      document.getElementById('patch-results-area').innerHTML = '';
      document.getElementById('patch-results-area').classList.add('hidden');
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
