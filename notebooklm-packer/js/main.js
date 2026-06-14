import {
  openDb,
  getAllArticleMeta,
  existsArticleMeta,
  saveSuccessArticle,
  saveFailedArticle,
  deleteArticleRecord,
  deleteFailedUrl,
  getAllCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  assignCategory,
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

const failedAreaEl = document.getElementById('failed-area');
const failedCountEl = document.getElementById('failed-count');
const failedListEl = document.getElementById('failed-list');

const articleListEl = document.getElementById('article-card-list');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

const categoryNameInput = document.getElementById('category-name-input');
const categoryAddBtn = document.getElementById('category-add-btn');
const categoryStatus = document.getElementById('category-status');
const categoryEmptyNote = document.getElementById('category-empty-note');
const categoryListEl = document.getElementById('category-list');

const categorySheetOverlay = document.getElementById('category-sheet-overlay');
const categorySheet = document.getElementById('category-sheet');
const categorySheetListEl = document.getElementById('category-sheet-list');
const categorySheetNewInput = document.getElementById('category-sheet-new-input');
const categorySheetCreateBtn = document.getElementById('category-sheet-create-btn');
const categorySheetStatus = document.getElementById('category-sheet-status');
const categorySheetCloseBtn = document.getElementById('category-sheet-close-btn');

// カテゴリ付けシートの対象記事ID（シートが閉じている時はnull）
let categorySheetArticleId = null;

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
  categoryAddBtn.addEventListener('click', handleAddCategory);

  categorySheetOverlay.addEventListener('click', closeCategorySheet);
  categorySheetCloseBtn.addEventListener('click', closeCategorySheet);
  categorySheetCreateBtn.addEventListener('click', handleCreateCategoryInSheet);

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
  await fetchAndSave(id, originalUrl);
  removeFetchingItem(id);
  await renderAll();
}

/**
 * 本文を取得し、結果に応じてarticleMeta(+articleBody)を保存する。
 * 既存のレコード（failed等）があっても上書きする想定。
 * @param {string} id
 * @param {string} originalUrl
 */
async function fetchAndSave(id, originalUrl) {
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
// 取得失敗エリア
// -----------------------------------------------
async function handleRetryFailed(id, originalUrl) {
  await fetchAndSave(id, originalUrl);
  await renderAll();
}

function handleOpenFailed(originalUrl) {
  window.open(originalUrl, '_blank', 'noopener');
}

async function handleDeleteFailed(id) {
  await deleteFailedUrl(db, id);
  await renderAll();
}

// -----------------------------------------------
// 一覧描画
// -----------------------------------------------
async function renderAll() {
  await renderUrlFoldList();
  await renderFailedArea();
  await renderArticleList();
  await renderCategoryList();
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
// 取得失敗エリア
// -----------------------------------------------
async function renderFailedArea() {
  const metas = await getAllArticleMeta(db);
  const failedMetas = metas
    .filter(meta => meta.status === 'failed')
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  failedAreaEl.hidden = failedMetas.length === 0;
  failedCountEl.textContent = String(failedMetas.length);
  failedListEl.innerHTML = '';

  for (const meta of failedMetas) {
    failedListEl.appendChild(buildFailedItem(meta));
  }
}

function buildFailedItem(meta) {
  const li = document.createElement('li');
  li.className = 'failed-item';
  li.dataset.articleId = meta.id;

  li.innerHTML = `
    <p class="failed-url truncate">${escapeHtml(meta.originalUrl)}</p>
    <p class="failed-domain truncate">${escapeHtml(meta.domain)}</p>
    <div class="failed-actions">
      <button type="button" class="btn btn-small btn-retry-failed">再試行</button>
      <button type="button" class="btn btn-small btn-open-failed">開く</button>
      <button type="button" class="btn btn-small btn-delete-failed">削除</button>
    </div>
  `;

  li.querySelector('.btn-retry-failed').addEventListener('click', () => handleRetryFailed(meta.id, meta.originalUrl));
  li.querySelector('.btn-open-failed').addEventListener('click', () => handleOpenFailed(meta.originalUrl));
  li.querySelector('.btn-delete-failed').addEventListener('click', () => handleDeleteFailed(meta.id));

  return li;
}

// -----------------------------------------------
// カテゴリ
// -----------------------------------------------
async function handleAddCategory() {
  const name = categoryNameInput.value;

  try {
    await createCategory(db, name);
  } catch (err) {
    setCategoryStatus(err.message, 'error');
    return;
  }

  categoryNameInput.value = '';
  setCategoryStatus('カテゴリを追加しました', 'success');
  await renderCategoryList();
}

async function handleDeleteCategory(id) {
  const confirmed = window.confirm('このカテゴリを削除します。記事は削除されず、未分類に戻ります。よろしいですか？');
  if (!confirmed) {
    return;
  }

  await deleteCategory(db, id);
  setCategoryStatus('カテゴリを削除しました', 'success');
  await renderCategoryList();
}

async function renderCategoryList() {
  const categories = await getAllCategories(db);
  categories.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  categoryEmptyNote.hidden = categories.length > 0;
  categoryListEl.innerHTML = '';

  for (const category of categories) {
    categoryListEl.appendChild(buildCategoryItem(category));
  }
}

function buildCategoryItem(category) {
  const li = document.createElement('li');
  li.className = 'category-list-item';
  li.dataset.categoryId = category.id;

  li.innerHTML = `
    <span class="category-name truncate">${escapeHtml(category.name)}</span>
    <div class="category-actions">
      <button type="button" class="btn btn-small btn-rename-category">名前変更</button>
      <button type="button" class="btn btn-small btn-delete-category">削除</button>
    </div>
  `;

  li.querySelector('.btn-rename-category').addEventListener('click', () => showCategoryRenameForm(li, category));
  li.querySelector('.btn-delete-category').addEventListener('click', () => handleDeleteCategory(category.id));

  return li;
}

/**
 * カテゴリ項目をインライン入力（名前変更フォーム）に切り替える。
 * @param {HTMLElement} li
 * @param {{ id: string, name: string }} category
 */
function showCategoryRenameForm(li, category) {
  li.innerHTML = `
    <input type="text" class="category-rename-input" value="${escapeHtml(category.name)}">
    <div class="category-actions">
      <button type="button" class="btn btn-small btn-save-category-rename">保存</button>
      <button type="button" class="btn btn-small btn-cancel-category-rename">キャンセル</button>
    </div>
  `;

  const input = li.querySelector('.category-rename-input');

  li.querySelector('.btn-save-category-rename').addEventListener('click', async () => {
    try {
      await renameCategory(db, category.id, input.value);
    } catch (err) {
      setCategoryStatus(err.message, 'error');
      return;
    }
    setCategoryStatus('カテゴリ名を変更しました', 'success');
    await renderCategoryList();
  });

  li.querySelector('.btn-cancel-category-rename').addEventListener('click', () => {
    renderCategoryList();
  });
}

function setCategoryStatus(message, type) {
  categoryStatus.textContent = message;
  categoryStatus.className = `status-text status-${type}`;
}

// -----------------------------------------------
// カテゴリ付けシート
// -----------------------------------------------
async function openCategorySheet(articleId, currentCategoryId) {
  categorySheetArticleId = articleId;
  categorySheetNewInput.value = '';
  setCategorySheetStatus('', '');

  await renderCategorySheetList(currentCategoryId);

  categorySheetOverlay.hidden = false;
  categorySheet.hidden = false;
}

function closeCategorySheet() {
  categorySheetArticleId = null;
  categorySheetOverlay.hidden = true;
  categorySheet.hidden = true;
}

async function renderCategorySheetList(currentCategoryId) {
  const categories = await getAllCategories(db);
  categories.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  categorySheetListEl.innerHTML = '';

  categorySheetListEl.appendChild(
    buildCategorySheetItem('未分類に戻す', '', currentCategoryId === '' || !currentCategoryId)
  );

  for (const category of categories) {
    categorySheetListEl.appendChild(
      buildCategorySheetItem(category.name, category.id, category.id === currentCategoryId)
    );
  }
}

function buildCategorySheetItem(label, categoryId, isCurrent) {
  const li = document.createElement('li');
  li.className = 'category-sheet-item';

  const optionClass = isCurrent ? 'category-sheet-option category-sheet-option--current' : 'category-sheet-option';
  const suffix = isCurrent ? ' ✓' : '';

  li.innerHTML = `<button type="button" class="${optionClass}">${escapeHtml(label)}${suffix}</button>`;
  li.querySelector('button').addEventListener('click', () => handleSelectCategory(categoryId));

  return li;
}

async function handleSelectCategory(categoryId) {
  if (categorySheetArticleId === null) {
    return;
  }

  await assignCategory(db, categorySheetArticleId, categoryId);
  closeCategorySheet();
  await renderAll();
}

async function handleCreateCategoryInSheet() {
  if (categorySheetArticleId === null) {
    return;
  }

  const name = categorySheetNewInput.value;

  let category;
  try {
    category = await createCategory(db, name);
  } catch (err) {
    setCategorySheetStatus(err.message, 'error');
    return;
  }

  await assignCategory(db, categorySheetArticleId, category.id);
  closeCategorySheet();
  await renderAll();
}

function setCategorySheetStatus(message, type) {
  categorySheetStatus.textContent = message;
  categorySheetStatus.className = `status-text${type ? ` status-${type}` : ''}`;
}

// -----------------------------------------------
// 記事カード一覧
// -----------------------------------------------
async function renderArticleList() {
  const metas = await getAllArticleMeta(db);
  const successMetas = metas
    .filter(meta => meta.status === 'success')
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  const categories = await getAllCategories(db);
  const categoryMap = new Map(categories.map(c => [c.id, c.name]));

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
    articleListEl.appendChild(buildArticleCard(meta, categoryMap));
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

function buildArticleCard(meta, categoryMap) {
  const card = document.createElement('div');
  card.className = 'article-card article-card--success';
  card.dataset.articleId = meta.id;

  const categoryLabel = resolveCategoryLabel(meta.categoryId, categoryMap);

  card.innerHTML = `
    <p class="article-source truncate">Source: ${escapeHtml(meta.originalUrl)}</p>
    <p class="article-title truncate">${escapeHtml(meta.title)}</p>
    <p class="article-domain truncate">${escapeHtml(meta.domain)}</p>
    <button type="button" class="article-category-btn">${escapeHtml(categoryLabel)} ▾</button>
    <p class="article-state">約${(meta.charCount ?? 0).toLocaleString('ja-JP')}字</p>
  `;

  card.querySelector('.article-category-btn').addEventListener('click', () => openCategorySheet(meta.id, meta.categoryId));

  return card;
}

/**
 * categoryIdに対応するカテゴリ名を解決する。
 * 未分類、または対応するカテゴリが見つからない場合は安全に「未分類」を返す。
 * @param {string} categoryId
 * @param {Map<string, string>} categoryMap
 * @returns {string}
 */
function resolveCategoryLabel(categoryId, categoryMap) {
  if (!categoryId) {
    return '未分類';
  }
  return categoryMap.get(categoryId) ?? '未分類';
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
