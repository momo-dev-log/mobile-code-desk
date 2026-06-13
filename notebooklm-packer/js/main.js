import {
  openDb,
  recoverOrphanedFetches,
  getAllArticleMeta,
  getArticleMeta,
  putArticleMeta,
  putArticleMetaAndBody,
  deleteArticle,
  getOrCreatePack,
  putPack,
} from './db.js';
import { normalizeUrl } from './normalize.js';
import { fetchArticleHtml } from './fetch.js';
import { extractArticle } from './extract.js';
import {
  BODY_TOO_LARGE_CHARS,
  PACK_WARN_THRESHOLD,
} from './constants.js';

let db;
let pack;

// 複数URL取り込み確認待ちのID一覧
let pendingFetchIds = [];

// -----------------------------------------------
// DOM要素
// -----------------------------------------------
const urlFoldToggle = document.getElementById('url-fold-toggle');
const urlFoldArrow = document.getElementById('url-fold-arrow');
const urlFoldCountEl = document.getElementById('url-fold-count');
const urlFoldBody = document.getElementById('url-fold-body');
const urlListEl = document.getElementById('url-list');

const urlTextarea = document.getElementById('url-textarea');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');

const importConfirmEl = document.getElementById('import-confirm');
const importConfirmText = document.getElementById('import-confirm-text');
const importConfirmFetchBtn = document.getElementById('import-confirm-fetch-btn');

const articleListEl = document.getElementById('article-card-list');

const packCountEl = document.getElementById('pack-count');
const packWarnEl = document.getElementById('pack-warn');
const packListEl = document.getElementById('pack-list');
const tabPackBadgeEl = document.getElementById('tab-pack-badge');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

init();

async function init() {
  db = await openDb();
  const recovered = await recoverOrphanedFetches(db);
  if (recovered > 0) {
    setImportStatus(`取得中だった${recovered}件を「取得できませんでした」として復帰しました`, 'warn');
  }
  pack = await getOrCreatePack(db);

  setupTabs();

  urlFoldToggle.addEventListener('click', () => {
    const isOpen = !urlFoldBody.hidden;
    urlFoldBody.hidden = isOpen;
    urlFoldArrow.textContent = isOpen ? '▸' : '▾';
  });

  importBtn.addEventListener('click', handleImport);
  importConfirmFetchBtn.addEventListener('click', handleImportConfirmFetch);

  await renderAll();
}

// -----------------------------------------------
// タブ切り替え
// -----------------------------------------------
function setupTabs() {
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tab !== tabName;
  });
  tabBtns.forEach((btn) => {
    btn.classList.toggle('tab-btn--active', btn.dataset.tab === tabName);
  });
}

// -----------------------------------------------
// 取り込み（記事タブ）
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

  const { createdCount, duplicateCount, createdIds } = await importUrls(validUrls);
  urlTextarea.value = '';
  await finishImport(createdCount, duplicateCount, createdIds);
}

/**
 * 取り込み確定後の共通処理。
 * 0件: 案内のみ。1件: 即時取得。2件以上: 確認UIを表示する。
 */
async function finishImport(createdCount, duplicateCount, createdIds) {
  const dupNote = duplicateCount > 0 ? `（既存${duplicateCount}件は取り込み済みのためスキップ）` : '';

  if (createdCount === 0) {
    setImportStatus(`新しいURLはありませんでした${dupNote}`, 'warn');
    await renderAll();
    return;
  }

  setImportStatus(`${createdCount}件のURLを取り込みました${dupNote}`, 'success');
  await renderAll();

  if (createdCount === 1) {
    await startFetch(createdIds[0]);
  } else {
    pendingFetchIds = createdIds;
    importConfirmText.textContent = `${createdCount}件のURLを取り込みました。本文を取得しますか？`;
    importConfirmEl.hidden = false;
  }
}

async function handleImportConfirmFetch() {
  importConfirmEl.hidden = true;
  const ids = pendingFetchIds;
  pendingFetchIds = [];
  for (const id of ids) {
    await startFetch(id);
  }
}

/**
 * URL一覧をarticleMetaとして取り込む（重複は既存記事を維持）。
 * @param {string[]} urls
 * @returns {Promise<{ createdCount: number, duplicateCount: number, createdIds: string[] }>}
 */
async function importUrls(urls) {
  let createdCount = 0;
  let duplicateCount = 0;
  const createdIds = [];

  for (const originalUrl of urls) {
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

  return { createdCount, duplicateCount, createdIds };
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
      setImportStatus('再取得に失敗しました', 'error');
    } else {
      meta.fetchState = 'failed';
      meta.failReason = null;
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
      meta.failReason = null;
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
      meta.failReason = null;
      meta.httpStatus = result.httpStatus;
      meta.finalUrl = result.finalUrl;
      meta.updatedAt = new Date().toISOString();
      await putArticleMeta(db, meta);
    }
    await renderAll();
    return;
  }

  // 成功
  const now = new Date().toISOString();
  meta.fetchState = 'fetched';
  meta.failReason = null;
  meta.title = title;
  meta.domain = getDomain(meta.originalUrl);
  meta.charCount = charCount;
  meta.fetchedAt = now;
  meta.finalUrl = result.finalUrl;
  meta.httpStatus = result.httpStatus;
  meta.warnings = [];
  meta.updatedAt = now;

  await putArticleMetaAndBody(db, meta, { id, body });
  await renderAll();
}

// -----------------------------------------------
// 候補（pack）操作（旧UI互換: #legacy-pack-compat内のみで使用）
// -----------------------------------------------
async function removeFromPack(id) {
  pack.items = pack.items.filter(itemId => itemId !== id);
  pack.updatedAt = new Date().toISOString();
  await putPack(db, pack);
  await renderAll();
}

// -----------------------------------------------
// URL一覧からの削除
// -----------------------------------------------
async function handleDeleteArticle(id) {
  await deleteArticle(db, id);
  await renderAll();
}

// -----------------------------------------------
// 一覧描画
// -----------------------------------------------
async function renderAll() {
  await renderUrlFoldList();
  await renderArticleList();
  await renderPackSection();
}

// -----------------------------------------------
// 折りたたみ: 取り込み済みURL一覧
// -----------------------------------------------
async function renderUrlFoldList() {
  const metas = await getAllArticleMeta(db);
  metas.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  urlFoldCountEl.textContent = String(metas.length);
  urlListEl.innerHTML = '';

  if (metas.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'まだURLが取り込まれていません';
    urlListEl.appendChild(li);
    return;
  }

  for (const meta of metas) {
    const li = document.createElement('li');
    li.className = 'url-list-item';
    li.innerHTML = `
      <span class="url-list-title truncate">${escapeHtml(meta.title)}</span>
      <span class="url-list-domain truncate">${escapeHtml(meta.domain)}</span>
      <button type="button" class="btn btn-small btn-delete-url">削除</button>
    `;
    li.querySelector('.btn-delete-url').addEventListener('click', () => handleDeleteArticle(meta.id));
    urlListEl.appendChild(li);
  }
}

// -----------------------------------------------
// 記事カード一覧
// -----------------------------------------------
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

  const titleHtml = `<p class="article-title truncate">${escapeHtml(meta.title)}</p>`;
  const domainHtml = `<p class="article-domain truncate">${escapeHtml(meta.domain)}</p>`;

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
      <p class="article-state article-state--error">取得に失敗しました</p>
      <button type="button" class="btn btn-retry">再試行</button>
    `;
  } else if (meta.fetchState === 'fetched') {
    bodyHtml = `
      <p class="article-state">約${meta.charCount.toLocaleString('ja-JP')}字</p>
    `;
  }

  card.innerHTML = `
    <p class="article-source truncate">Source: ${escapeHtml(meta.originalUrl)}</p>
    ${titleHtml}
    ${domainHtml}
    ${bodyHtml}
  `;

  // イベントバインド
  const fetchBtn = card.querySelector('.btn-fetch');
  if (fetchBtn) fetchBtn.addEventListener('click', () => startFetch(meta.id));

  const retryBtn = card.querySelector('.btn-retry');
  if (retryBtn) retryBtn.addEventListener('click', () => startFetch(meta.id));

  return card;
}

// -----------------------------------------------
// 候補一覧（旧UI互換: #legacy-pack-compat内のみで使用）
// -----------------------------------------------
async function renderPackSection() {
  packCountEl.textContent = `${pack.items.length}件選択中`;

  packWarnEl.hidden = pack.items.length <= PACK_WARN_THRESHOLD;
  if (!packWarnEl.hidden) {
    packWarnEl.textContent = '50件を超えています。NotebookLMで扱いやすい量を超えている可能性があります';
  }

  if (pack.items.length > 0) {
    tabPackBadgeEl.hidden = false;
    tabPackBadgeEl.textContent = String(pack.items.length);
  } else {
    tabPackBadgeEl.hidden = true;
  }

  packListEl.innerHTML = '';

  for (const id of pack.items) {
    const meta = await getArticleMeta(db, id);
    if (!meta) continue;

    const li = document.createElement('li');
    li.className = 'pack-list-item';
    li.innerHTML = `
      <span class="pack-item-title truncate">${escapeHtml(meta.title)}</span>
      <span class="pack-item-domain truncate">${escapeHtml(meta.domain)}</span>
      <button type="button" class="btn btn-small btn-remove-pack-item">候補から外す</button>
    `;
    li.querySelector('.btn-remove-pack-item').addEventListener('click', () => removeFromPack(id));
    packListEl.appendChild(li);
  }
}

// UTF-8 BOM。Windows標準アプリ（メモ帳・Excel等）でUTF-8として
// 正しく認識させるために付与する。
const UTF8_BOM = '﻿';

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([UTF8_BOM, content], { type: `${mimeType}; charset=utf-8` });
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
