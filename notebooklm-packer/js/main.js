import {
  openDb,
  getAllArticleMeta,
  existsArticleMeta,
  saveSuccessArticle,
  saveFailedArticle,
  deleteArticleRecord,
} from './db.js';
import { normalizeUrl } from './normalize.js';
import { fetchArticleHtml } from './fetch.js';
import { extractArticle } from './extract.js';
import { BODY_TOO_LARGE_CHARS } from './constants.js';

let db;

// 取得中のURL（DBには保存しない、UI上の一時状態）
let fetchingItems = [];

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

const articleListEl = document.getElementById('article-card-list');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

init();

async function init() {
  db = await openDb();

  setupTabs();

  urlFoldToggle.addEventListener('click', () => {
    const isOpen = !urlFoldBody.hidden;
    urlFoldBody.hidden = isOpen;
    urlFoldArrow.textContent = isOpen ? '▸' : '▾';
  });

  importBtn.addEventListener('click', handleImport);

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

  urlTextarea.value = '';
  await importAndFetch(validUrls);
}

/**
 * URLを正規化・重複チェックし、新規分のみ取得中カードを表示してから本文取得を開始する。
 * @param {string[]} urls
 */
async function importAndFetch(urls) {
  const targets = [];
  const seenIds = new Set();
  let duplicateCount = 0;

  for (const originalUrl of urls) {
    let id;
    try {
      id = normalizeUrl(originalUrl);
    } catch {
      continue;
    }

    if (seenIds.has(id) || fetchingItems.some(item => item.id === id)) {
      duplicateCount += 1;
      continue;
    }

    if (await existsArticleMeta(db, id)) {
      duplicateCount += 1;
      continue;
    }

    seenIds.add(id);
    targets.push({ id, originalUrl });
  }

  const dupNote = duplicateCount > 0 ? `（既存${duplicateCount}件は取り込み済みのためスキップ）` : '';

  if (targets.length === 0) {
    setImportStatus(`新しいURLはありませんでした${dupNote}`, 'warn');
    return;
  }

  setImportStatus(`${targets.length}件のURLの取得を開始しました${dupNote}`, 'success');

  for (const target of targets) {
    fetchingItems.push({
      id: target.id,
      originalUrl: target.originalUrl,
      domain: getDomain(target.originalUrl),
    });
  }
  await renderAll();

  for (const target of targets) {
    await startFetch(target.id, target.originalUrl);
  }
}

// -----------------------------------------------
// 本文取得
// -----------------------------------------------
async function startFetch(id, originalUrl) {
  const domain = getDomain(originalUrl);
  const now = new Date().toISOString();

  const result = await fetchArticleHtml(originalUrl);

  if (!result.ok) {
    await saveFailedArticle(db, {
      id,
      normalizedUrl: id,
      originalUrl,
      domain,
      categoryId: '',
      isExported: false,
      fetchedAt: now,
    });
    removeFetchingItem(id);
    await renderAll();
    return;
  }

  const { title, body, charCount } = extractArticle(result.html, originalUrl);

  if (body.trim() === '' || charCount > BODY_TOO_LARGE_CHARS) {
    await saveFailedArticle(db, {
      id,
      normalizedUrl: id,
      originalUrl,
      domain,
      categoryId: '',
      isExported: false,
      fetchedAt: now,
    });
    removeFetchingItem(id);
    await renderAll();
    return;
  }

  await saveSuccessArticle(db, {
    id,
    normalizedUrl: id,
    originalUrl,
    title,
    domain,
    categoryId: '',
    isExported: false,
    fetchedAt: now,
    charCount,
  }, { id, body });

  removeFetchingItem(id);
  await renderAll();
}

function removeFetchingItem(id) {
  fetchingItems = fetchingItems.filter(item => item.id !== id);
}

// -----------------------------------------------
// URL一覧からの削除
// -----------------------------------------------
async function handleDeleteArticle(id) {
  await deleteArticleRecord(db, id);
  await renderAll();
}

// -----------------------------------------------
// 一覧描画
// -----------------------------------------------
async function renderAll() {
  await renderUrlFoldList();
  await renderArticleList();
}

// -----------------------------------------------
// 折りたたみ: 取り込み済みURL一覧
// -----------------------------------------------
async function renderUrlFoldList() {
  const metas = await getAllArticleMeta(db);
  metas.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

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
      <span class="url-list-title truncate">${escapeHtml(meta.title || meta.originalUrl)}</span>
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
  const successMetas = metas
    .filter(meta => meta.status === 'success')
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  articleListEl.innerHTML = '';

  if (fetchingItems.length === 0 && successMetas.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'まだURLが取り込まれていません';
    articleListEl.appendChild(p);
    return;
  }

  for (const item of fetchingItems) {
    articleListEl.appendChild(buildFetchingCard(item));
  }

  for (const meta of successMetas) {
    articleListEl.appendChild(buildArticleCard(meta));
  }
}

function buildFetchingCard(item) {
  const card = document.createElement('div');
  card.className = 'article-card article-card--fetching';
  card.dataset.articleId = item.id;

  card.innerHTML = `
    <p class="article-source truncate">Source: ${escapeHtml(item.originalUrl)}</p>
    <p class="article-domain truncate">${escapeHtml(item.domain)}</p>
    <p class="article-state">取得中…</p>
  `;

  return card;
}

function buildArticleCard(meta) {
  const card = document.createElement('div');
  card.className = 'article-card article-card--success';
  card.dataset.articleId = meta.id;

  card.innerHTML = `
    <p class="article-source truncate">Source: ${escapeHtml(meta.originalUrl)}</p>
    <p class="article-title truncate">${escapeHtml(meta.title)}</p>
    <p class="article-domain truncate">${escapeHtml(meta.domain)}</p>
    <p class="article-state">約${(meta.charCount ?? 0).toLocaleString('ja-JP')}字</p>
  `;

  return card;
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
