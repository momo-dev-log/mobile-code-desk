import {
  openDb,
  recoverOrphanedFetches,
  getAllArticleMeta,
  getArticleMeta,
  getArticleBody,
  putArticleMeta,
  putArticleMetaAndBody,
  getOrCreatePack,
  putPack,
  DEFAULT_PACK_NAME,
} from './db.js';
import { normalizeUrl } from './normalize.js';
import { fetchArticleHtml } from './fetch.js';
import { extractArticle } from './extract.js';
import { buildPackMarkdown, markdownToPlainText, generateFilename, sanitizePackName } from './markdown.js';
import { SHORT_BODY_THRESHOLD, BODY_TOO_LARGE_CHARS, PACK_WARN_THRESHOLD } from './constants.js';

let db;
let pack;

// 立ち読み展開中のID（表示のみ。永続化しない）
const expandedIds = new Set();

// 仕上げで生成済みのMarkdown/txt（ダウンロード用に保持）
let generatedFiles = null;

const urlTextarea = document.getElementById('url-textarea');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');
const articleListEl = document.getElementById('article-list');
const packCountEl = document.getElementById('pack-count');
const packWarnEl = document.getElementById('pack-warn');
const packListEl = document.getElementById('pack-list');
const finishSection = document.getElementById('finish-section');
const finishBtn = document.getElementById('finish-btn');
const packNameInput = document.getElementById('pack-name-input');
const txtCheckbox = document.getElementById('txt-checkbox');
const buildBtn = document.getElementById('build-btn');
const saveBtn = document.getElementById('save-btn');
const buildStatus = document.getElementById('build-status');

init();

async function init() {
  db = await openDb();
  const recovered = await recoverOrphanedFetches(db);
  if (recovered > 0) {
    setImportStatus(`取得中だった${recovered}件を「取得できませんでした」として復帰しました`, 'warn');
  }
  pack = await getOrCreatePack(db);

  importBtn.addEventListener('click', handleImport);
  finishBtn.addEventListener('click', () => {
    finishSection.hidden = false;
    finishSection.scrollIntoView({ behavior: 'smooth' });
  });
  buildBtn.addEventListener('click', handleBuildPack);
  saveBtn.addEventListener('click', handleSaveFiles);

  await renderAll();
}

// -----------------------------------------------
// 取り込み（さがすタブ相当の最小実装）
// -----------------------------------------------
async function handleImport() {
  const rawInput = urlTextarea.value;
  const lines = rawInput
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    setImportStatus('URLを入力してください', 'error');
    return;
  }

  const validUrls = [];
  for (const line of lines) {
    try {
      new URL(line);
      validUrls.push(line);
    } catch {
      // 無効な行はスキップ
    }
  }

  if (validUrls.length === 0) {
    setImportStatus('有効なURLが見つかりませんでした', 'error');
    return;
  }

  let createdCount = 0;
  let duplicateCount = 0;
  const createdIds = [];

  for (const originalUrl of validUrls) {
    let id;
    try {
      id = normalizeUrl(originalUrl);
    } catch {
      continue;
    }

    const existing = await getArticleMeta(db, id);
    if (existing) {
      duplicateCount += 1;
      continue;
    }

    const now = new Date().toISOString();
    const meta = {
      id,
      originalUrl,
      finalUrl: null,
      title: originalUrl,
      domain: getDomain(originalUrl),
      charCount: 0,
      fetchedAt: null,
      fetchState: 'idle',
      failReason: null,
      warnings: [],
      httpStatus: null,
      createdAt: now,
      updatedAt: now,
    };
    await putArticleMeta(db, meta);
    createdCount += 1;
    createdIds.push(id);
  }

  urlTextarea.value = '';

  const dupNote = duplicateCount > 0 ? `（既存${duplicateCount}件は取り込み済みのためスキップ）` : '';
  if (createdCount === 0) {
    setImportStatus(`新しいURLはありませんでした${dupNote}`, 'warn');
    await renderAll();
    return;
  }

  setImportStatus(`${createdCount}件のURLを取り込みました${dupNote}`, 'success');
  await renderAll();

  // 1件のみの場合は即時取得
  if (createdCount === 1) {
    await startFetch(createdIds[0]);
  }
}

// -----------------------------------------------
// 本文取得（取得・取り直し共通）
// -----------------------------------------------
async function startFetch(id) {
  const meta = await getArticleMeta(db, id);
  if (!meta) return;

  const isRefetch = meta.fetchState === 'fetched';
  const prevWarnings = meta.warnings;
  const prevTitle = meta.title;
  const prevCharCount = meta.charCount;
  const prevFetchedAt = meta.fetchedAt;
  const prevFinalUrl = meta.finalUrl;
  const prevHttpStatus = meta.httpStatus;

  meta.fetchState = 'fetching';
  meta.updatedAt = new Date().toISOString();
  await putArticleMeta(db, meta);
  await renderAll();

  const result = await fetchArticleHtml(meta.originalUrl);

  if (!result.ok) {
    if (isRefetch) {
      // 再取得モード: 失敗時は既存の本文・メタを保持したままfetchedに戻す
      meta.fetchState = 'fetched';
      meta.warnings = prevWarnings;
      meta.title = prevTitle;
      meta.charCount = prevCharCount;
      meta.fetchedAt = prevFetchedAt;
      meta.finalUrl = prevFinalUrl;
      meta.httpStatus = prevHttpStatus;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
      setImportStatus(`再取得に失敗しました: ${describeFailReason(classifyFailReason(result), result.httpStatus)}`, 'error');
    } else {
      meta.fetchState = 'failed';
      meta.failReason = classifyFailReason(result);
      meta.httpStatus = result.httpStatus ?? null;
      meta.finalUrl = null;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
    }
    await renderAll();
    return;
  }

  const { title, body, charCount } = extractArticle(result.html, meta.originalUrl);

  if (body.trim() === '') {
    if (isRefetch) {
      meta.fetchState = 'fetched';
      meta.warnings = prevWarnings;
      meta.title = prevTitle;
      meta.charCount = prevCharCount;
      meta.fetchedAt = prevFetchedAt;
      meta.finalUrl = prevFinalUrl;
      meta.httpStatus = prevHttpStatus;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
      setImportStatus('再取得に失敗しました: 本文を取り出せませんでした', 'error');
    } else {
      meta.fetchState = 'failed';
      meta.failReason = 'extract_empty';
      meta.httpStatus = result.httpStatus;
      meta.finalUrl = result.finalUrl;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
    }
    await renderAll();
    return;
  }

  if (charCount > BODY_TOO_LARGE_CHARS) {
    if (isRefetch) {
      meta.fetchState = 'fetched';
      meta.warnings = prevWarnings;
      meta.title = prevTitle;
      meta.charCount = prevCharCount;
      meta.fetchedAt = prevFetchedAt;
      meta.finalUrl = prevFinalUrl;
      meta.httpStatus = prevHttpStatus;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
      setImportStatus('再取得に失敗しました: ページが大きすぎるため対象外です', 'error');
    } else {
      meta.fetchState = 'failed';
      meta.failReason = 'too_large';
      meta.httpStatus = result.httpStatus;
      meta.finalUrl = result.finalUrl;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
    }
    await renderAll();
    return;
  }

  // 成功
  const warnings = [];
  if (charCount < SHORT_BODY_THRESHOLD) warnings.push('short_body');

  const now = new Date().toISOString();
  meta.fetchState = 'fetched';
  meta.failReason = null;
  meta.title = title;
  meta.domain = getDomain(meta.originalUrl);
  meta.charCount = charCount;
  meta.fetchedAt = now;
  meta.finalUrl = result.finalUrl;
  meta.httpStatus = result.httpStatus;
  meta.warnings = warnings;
  meta.updatedAt = now;

  await putArticleMetaAndBody(db, meta, { id, body });
  await renderAll();
}

function classifyFailReason(result) {
  if (result.reason === 'network' || result.reason === 'http_error' || result.reason === 'too_large') {
    return result.reason;
  }
  return 'network';
}

function describeFailReason(reason, httpStatus) {
  switch (reason) {
    case 'network': return '接続できませんでした';
    case 'http_error': return `ページを取得できませんでした（${httpStatus ?? ''}）`;
    case 'too_large': return 'ページが大きすぎるため対象外です';
    case 'extract_empty': return '本文を取り出せませんでした（会員限定ページの可能性があります）';
    default: return '取得に失敗しました';
  }
}

// -----------------------------------------------
// 候補（pack）操作
// -----------------------------------------------
async function addToPack(id) {
  if (pack.items.includes(id)) return;
  pack.items.push(id);
  pack.updatedAt = new Date().toISOString();
  await putPack(db, pack);
  await renderAll();
}

async function removeFromPack(id) {
  pack.items = pack.items.filter(itemId => itemId !== id);
  pack.updatedAt = new Date().toISOString();
  await putPack(db, pack);
  await renderAll();
}

// -----------------------------------------------
// 立ち読み
// -----------------------------------------------
async function togglePreview(id) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
  await renderAll();
}

// -----------------------------------------------
// 一覧描画
// -----------------------------------------------
async function renderAll() {
  await renderArticleList();
  await renderPackSection();
}

async function renderArticleList() {
  const metas = await getAllArticleMeta(db);
  metas.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  articleListEl.innerHTML = '';

  if (metas.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'まだURLが取り込まれていません';
    articleListEl.appendChild(p);
    return;
  }

  for (const meta of metas) {
    const card = await buildArticleCard(meta);
    articleListEl.appendChild(card);
  }
}

async function buildArticleCard(meta) {
  const card = document.createElement('div');
  card.className = `article-card article-card--${meta.fetchState}`;
  card.dataset.articleId = meta.id;

  const titleHtml = `<p class="article-title">${escapeHtml(meta.title)}</p>`;
  const domainHtml = `<p class="article-domain">${escapeHtml(meta.domain)}</p>`;

  let bodyHtml = '';

  if (meta.fetchState === 'idle') {
    bodyHtml = `
      <p class="article-state">未取得</p>
      <button type="button" class="btn btn-fetch">本文を取得する</button>
    `;
  } else if (meta.fetchState === 'fetching') {
    bodyHtml = `<p class="article-state">取得中…</p>`;
  } else if (meta.fetchState === 'failed') {
    bodyHtml = `
      <p class="article-state article-state--error">${escapeHtml(describeFailReason(meta.failReason, meta.httpStatus))}</p>
      <button type="button" class="btn btn-retry">再試行</button>
    `;
  } else if (meta.fetchState === 'fetched') {
    const isChecked = pack.items.includes(meta.id);
    const warnHtml = meta.warnings.includes('short_body')
      ? `<p class="article-warn">⚠️ 本文が短いため要確認（約${meta.charCount.toLocaleString('ja-JP')}字）</p>`
      : '';

    const addBtnHtml = isChecked
      ? `<span class="badge badge-checked">✅ パック候補に追加済み</span>
         <button type="button" class="btn btn-small btn-remove-pack">候補から外す</button>`
      : `<button type="button" class="btn btn-add-pack">パック候補に追加</button>`;

    const isExpanded = expandedIds.has(meta.id);
    const previewBtnHtml = isExpanded
      ? `<button type="button" class="btn btn-toggle-preview">立ち読みを閉じる</button>`
      : `<button type="button" class="btn btn-toggle-preview">立ち読みを開く</button>`;

    const refetchBtnHtml = meta.warnings.includes('short_body')
      ? `<button type="button" class="btn btn-small btn-refetch">最新版を取り直す</button>`
      : '';

    let previewAreaHtml = '';
    if (isExpanded) {
      const bodyRecord = await getArticleBody(db, meta.id);
      const bodyText = bodyRecord ? bodyRecord.body : '';
      const previewText = bodyText.slice(0, 800);
      const smallRefetchHtml = !meta.warnings.includes('short_body')
        ? `<button type="button" class="btn btn-small btn-refetch">最新版を取り直す</button>`
        : '';
      previewAreaHtml = `
        <div class="preview-area">
          <button type="button" class="btn btn-toggle-preview">立ち読みを閉じる</button>
          <div class="preview-text">${escapeHtml(previewText)}</div>
          <button type="button" class="btn btn-toggle-preview">立ち読みを閉じる</button>
          ${smallRefetchHtml}
        </div>
      `;
    }

    bodyHtml = `
      <p class="article-state">約${meta.charCount.toLocaleString('ja-JP')}字</p>
      ${warnHtml}
      <div class="article-actions">
        ${addBtnHtml}
        ${isExpanded ? '' : previewBtnHtml}
        ${refetchBtnHtml}
      </div>
      ${previewAreaHtml}
    `;
  }

  card.innerHTML = `
    <p class="article-source">Source: ${escapeHtml(meta.originalUrl)}</p>
    ${titleHtml}
    ${domainHtml}
    ${bodyHtml}
  `;

  // イベントバインド
  const fetchBtn = card.querySelector('.btn-fetch');
  if (fetchBtn) fetchBtn.addEventListener('click', () => startFetch(meta.id));

  const retryBtn = card.querySelector('.btn-retry');
  if (retryBtn) retryBtn.addEventListener('click', () => startFetch(meta.id));

  const refetchBtns = card.querySelectorAll('.btn-refetch');
  refetchBtns.forEach(btn => btn.addEventListener('click', () => startFetch(meta.id)));

  const addBtn = card.querySelector('.btn-add-pack');
  if (addBtn) addBtn.addEventListener('click', () => addToPack(meta.id));

  const removeBtn = card.querySelector('.btn-remove-pack');
  if (removeBtn) removeBtn.addEventListener('click', () => removeFromPack(meta.id));

  const toggleBtns = card.querySelectorAll('.btn-toggle-preview');
  toggleBtns.forEach(btn => btn.addEventListener('click', () => togglePreview(meta.id)));

  return card;
}

// -----------------------------------------------
// 候補一覧
// -----------------------------------------------
async function renderPackSection() {
  packCountEl.textContent = `${pack.items.length}件選択中`;

  packWarnEl.hidden = pack.items.length <= PACK_WARN_THRESHOLD;
  if (!packWarnEl.hidden) {
    packWarnEl.textContent = '50件を超えています。NotebookLMで扱いやすい量を超えている可能性があります';
  }

  packListEl.innerHTML = '';

  for (const id of pack.items) {
    const meta = await getArticleMeta(db, id);
    if (!meta) continue;

    const li = document.createElement('li');
    li.className = 'pack-list-item';
    const warnNote = meta.warnings.includes('short_body')
      ? ` <span class="article-warn-inline">⚠️ 約${meta.charCount.toLocaleString('ja-JP')}字</span>`
      : '';
    li.innerHTML = `
      <span class="pack-item-title">${escapeHtml(meta.title)}</span>
      <span class="pack-item-domain">${escapeHtml(meta.domain)}</span>${warnNote}
      <button type="button" class="btn btn-small btn-remove-pack-item">候補から外す</button>
    `;
    li.querySelector('.btn-remove-pack-item').addEventListener('click', () => removeFromPack(id));
    packListEl.appendChild(li);
  }
}

// -----------------------------------------------
// 仕上げ
// -----------------------------------------------
async function handleBuildPack() {
  if (pack.items.length === 0) {
    setBuildStatus('候補が0件のため、パックのファイルを作成できません', 'error');
    return;
  }

  const packName = sanitizePackName(packNameInput.value || DEFAULT_PACK_NAME);

  const articles = [];
  for (const id of pack.items) {
    const meta = await getArticleMeta(db, id);
    if (!meta) continue;
    const bodyRecord = await getArticleBody(db, id);
    articles.push({
      title: meta.title,
      originalUrl: meta.originalUrl,
      domain: meta.domain,
      fetchedAt: meta.fetchedAt,
      charCount: meta.charCount,
      body: bodyRecord ? bodyRecord.body : null,
    });
  }

  const { markdown, skippedCount } = buildPackMarkdown(packName, articles);

  generatedFiles = {
    packName,
    markdown,
    txt: txtCheckbox.checked ? markdownToPlainText(markdown) : null,
  };

  saveBtn.hidden = false;
  const skipNote = skippedCount > 0 ? `（${skippedCount}件をスキップしました）` : '';
  setBuildStatus(`パックのファイルを作成しました${skipNote}`, 'success');
}

function handleSaveFiles() {
  if (!generatedFiles) return;

  downloadBlob(generatedFiles.markdown, generateFilename(generatedFiles.packName, 'md'), 'text/markdown');

  if (generatedFiles.txt) {
    downloadBlob(generatedFiles.txt, generateFilename(generatedFiles.packName, 'txt'), 'text/plain');
  }
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: `${mimeType}; charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------
// 共通ユーティリティ
// -----------------------------------------------
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setImportStatus(message, type) {
  importStatus.textContent = message;
  importStatus.className = `status-text status-${type}`;
}

function setBuildStatus(message, type) {
  buildStatus.textContent = message;
  buildStatus.className = `status-text status-${type}`;
}
