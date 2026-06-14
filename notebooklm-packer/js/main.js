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
  getArticleBody,
  setExported,
} from './db.js';
import { normalizeUrl } from './normalize.js';
import { fetchArticleHtml } from './fetch.js';
import { extractArticle } from './extract.js';
import { BODY_TOO_LARGE_CHARS } from './constants.js';

let db;

// 取得中のURL（DBには保存しない、UI上の一時状態）
let fetchingItems = [];

// カテゴリバーの選択状態: 'all' | 'unclassified' | カテゴリID
let currentCategoryFilter = 'all';

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

const categoryStatus = document.getElementById('category-status');
const categoryEmptyNote = document.getElementById('category-empty-note');
const categoryListEl = document.getElementById('category-list');

const categoryListView = document.getElementById('category-list-view');
const categoryDetailView = document.getElementById('category-detail-view');
const categoryDetailBackBtn = document.getElementById('category-detail-back-btn');
const categoryDetailTitle = document.getElementById('category-detail-title');
const categoryDetailExportBtn = document.getElementById('category-detail-export-btn');
const categoryDetailExportStatus = document.getElementById('category-detail-export-status');
const categoryDetailEmpty = document.getElementById('category-detail-empty');
const categoryDetailListEl = document.getElementById('category-detail-list');

// カテゴリ詳細ビューで表示中の対象: null（未表示） | 'unclassified' | カテゴリID
let currentCategoryDetailTarget = null;

const categorySheetOverlay = document.getElementById('category-sheet-overlay');
const categorySheet = document.getElementById('category-sheet');
const categorySheetListEl = document.getElementById('category-sheet-list');
const categorySheetNewInput = document.getElementById('category-sheet-new-input');
const categorySheetCreateBtn = document.getElementById('category-sheet-create-btn');
const categorySheetStatus = document.getElementById('category-sheet-status');
const categorySheetCloseBtn = document.getElementById('category-sheet-close-btn');

const categoryBarEl = document.getElementById('category-bar');
const categoryBarAddFormEl = document.getElementById('category-bar-add-form');
const categoryBarAddInput = document.getElementById('category-bar-add-input');
const categoryBarAddSaveBtn = document.getElementById('category-bar-add-save-btn');
const categoryBarAddCancelBtn = document.getElementById('category-bar-add-cancel-btn');
const categoryBarStatus = document.getElementById('category-bar-status');

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

  categorySheetOverlay.addEventListener('click', closeCategorySheet);
  categorySheetCloseBtn.addEventListener('click', closeCategorySheet);
  categorySheetCreateBtn.addEventListener('click', handleCreateCategoryInSheet);

  categoryBarAddSaveBtn.addEventListener('click', handleCreateCategoryFromBar);
  categoryBarAddCancelBtn.addEventListener('click', closeCategoryBarAddForm);

  categoryDetailBackBtn.addEventListener('click', closeCategoryDetail);
  categoryDetailExportBtn.addEventListener('click', handleExportCategoryDetail);

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
  document.body.classList.toggle('tab-articles-active', tabName === 'articles');
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
  const confirmed = window.confirm('この記事を削除します。\n本文データも削除されます。\nよろしいですか？');
  if (!confirmed) {
    return;
  }

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
  await renderCategoryBar();
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
// カテゴリバー
// -----------------------------------------------
async function renderCategoryBar() {
  const categories = await getAllCategories(db);
  categories.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  categoryBarEl.innerHTML = '';

  categoryBarEl.appendChild(buildCategoryBarItem('すべて', 'all'));
  categoryBarEl.appendChild(buildCategoryBarItem('未分類', 'unclassified'));

  for (const category of categories) {
    categoryBarEl.appendChild(buildCategoryBarItem(category.name, category.id));
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'category-bar-item';
  addBtn.textContent = '＋';
  addBtn.addEventListener('click', handleOpenCategoryBarAddForm);
  categoryBarEl.appendChild(addBtn);
}

function buildCategoryBarItem(label, value) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'category-bar-item';
  if (currentCategoryFilter === value) {
    btn.classList.add('category-bar-item--active');
  }
  btn.textContent = label;
  btn.addEventListener('click', () => handleSelectCategoryFilter(value));
  return btn;
}

async function handleSelectCategoryFilter(value) {
  currentCategoryFilter = value;
  await renderCategoryBar();
  await renderArticleList();
}

function handleOpenCategoryBarAddForm() {
  categoryBarAddInput.value = '';
  setCategoryBarStatus('', '');
  categoryBarAddFormEl.hidden = false;
}

function closeCategoryBarAddForm() {
  categoryBarAddFormEl.hidden = true;
}

async function handleCreateCategoryFromBar() {
  const name = categoryBarAddInput.value;

  let category;
  try {
    category = await createCategory(db, name);
  } catch (err) {
    setCategoryBarStatus(err.message, 'error');
    return;
  }

  currentCategoryFilter = category.id;
  categoryBarAddInput.value = '';
  setCategoryBarStatus('', '');
  closeCategoryBarAddForm();
  await renderCategoryBar();
  await renderArticleList();
  await renderCategoryList();
}

function setCategoryBarStatus(message, type) {
  setStatus(categoryBarStatus, message, type);
}

// -----------------------------------------------
// カテゴリ
// -----------------------------------------------
async function handleDeleteCategory(id) {
  const confirmed = window.confirm('このカテゴリを削除します。記事は削除されず、未分類に戻ります。よろしいですか？');
  if (!confirmed) {
    return;
  }

  await deleteCategory(db, id);
  setCategoryStatus('カテゴリを削除しました', 'success');
  await renderAll();
}

async function renderCategoryList() {
  const categories = await getAllCategories(db);
  categories.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  const metas = await getAllArticleMeta(db);
  const successMetas = metas.filter(meta => meta.status === 'success');

  categoryEmptyNote.hidden = categories.length > 0;
  categoryListEl.innerHTML = '';

  for (const category of categories) {
    const count = successMetas.filter(meta => meta.categoryId === category.id).length;
    categoryListEl.appendChild(buildCategoryCard(category, count));
  }

  const uncategorizedCount = successMetas.filter(meta => !meta.categoryId).length;
  categoryListEl.appendChild(buildUncategorizedCard(uncategorizedCount));

  if (currentCategoryDetailTarget) {
    await renderCategoryDetail(currentCategoryDetailTarget);
  }
}

function buildCategoryCard(category, count) {
  const li = document.createElement('li');
  li.className = 'category-card';
  li.dataset.categoryId = category.id;

  li.innerHTML = `
    <p class="category-card-name truncate">${escapeHtml(category.name)}</p>
    <p class="category-card-meta">${count}件</p>
    <button type="button" class="btn btn-primary category-card-export-btn">Markdownファイルを作る</button>
    <div class="category-card-actions">
      <button type="button" class="btn btn-small btn-rename-category">名前変更</button>
      <button type="button" class="btn btn-small btn-danger btn-delete-category">削除</button>
    </div>
  `;

  li.querySelector('.category-card-export-btn').addEventListener('click', () => {
    setCategoryDetailExportStatus('', '');
    renderCategoryDetail(category.id);
  });

  li.querySelector('.btn-rename-category').addEventListener('click', () => {
    showCategoryRenameForm(li, category);
  });
  li.querySelector('.btn-delete-category').addEventListener('click', () => {
    handleDeleteCategory(category.id);
  });

  return li;
}

function buildUncategorizedCard(count) {
  const li = document.createElement('li');
  li.className = 'category-card category-card--unclassified';

  li.innerHTML = `
    <p class="category-card-name">未分類</p>
    <p class="category-card-meta">${count}件</p>
    <p class="category-card-note">確認のみ</p>
  `;

  return li;
}

/**
 * カテゴリカードをインライン入力（名前変更フォーム）に切り替える。
 * @param {HTMLElement} li
 * @param {{ id: string, name: string }} category
 */
function showCategoryRenameForm(li, category) {
  li.innerHTML = `
    <div class="category-card-actions">
      <input type="text" class="category-rename-input" value="${escapeHtml(category.name)}">
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
  setStatus(categoryStatus, message, type);
}

// -----------------------------------------------
// カテゴリ詳細ビュー
// -----------------------------------------------

/**
 * カテゴリ詳細ビューを表示する。
 * @param {string} target - 'unclassified' または カテゴリID
 */
async function renderCategoryDetail(target) {
  let title;
  let categoryId;

  if (target === 'unclassified') {
    title = '未分類';
    categoryId = '';
  } else {
    const categories = await getAllCategories(db);
    const category = categories.find(c => c.id === target);
    if (!category) {
      // 削除済みカテゴリの詳細を開こうとした場合は安全に一覧へ戻す
      closeCategoryDetail();
      return;
    }
    title = category.name;
    categoryId = category.id;
  }

  currentCategoryDetailTarget = target;
  categoryDetailTitle.textContent = title;
  categoryDetailExportBtn.hidden = target === 'unclassified';

  const metas = await getAllArticleMeta(db);
  const targetMetas = metas
    .filter(meta => meta.status === 'success')
    .filter(meta => (target === 'unclassified' ? !meta.categoryId : meta.categoryId === categoryId))
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  categoryDetailListEl.innerHTML = '';
  categoryDetailEmpty.hidden = targetMetas.length > 0;

  for (const meta of targetMetas) {
    categoryDetailListEl.appendChild(buildCategoryDetailItem(meta));
  }

  categoryListView.hidden = true;
  categoryDetailView.hidden = false;
  categoryDetailBackBtn.hidden = false;
}

function buildCategoryDetailItem(meta) {
  const li = document.createElement('li');
  li.className = 'category-detail-item';

  li.innerHTML = `
    <p class="category-detail-item-title truncate">${escapeHtml(meta.title)}</p>
    <p class="category-detail-item-domain truncate">${escapeHtml(meta.domain)}</p>
    <p class="category-detail-item-url truncate">${escapeHtml(meta.originalUrl)}</p>
    ${buildExportedBadge(meta)}
  `;

  return li;
}

function closeCategoryDetail() {
  currentCategoryDetailTarget = null;
  categoryDetailView.hidden = true;
  categoryDetailBackBtn.hidden = true;
  categoryListView.hidden = false;
}

/**
 * 出力済みバッジのHTMLを返す（未出力の場合は空文字）。
 * @param {{ isExported?: boolean }} meta
 * @returns {string}
 */
function buildExportedBadge(meta) {
  return meta.isExported ? '<span class="exported-badge">● 出力済み</span>' : '';
}

// -----------------------------------------------
// Markdown出力（カテゴリ単位）
// -----------------------------------------------
async function handleExportCategoryDetail() {
  if (currentCategoryDetailTarget === null || currentCategoryDetailTarget === 'unclassified') {
    return;
  }

  const categoryId = currentCategoryDetailTarget;
  const categories = await getAllCategories(db);
  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    setCategoryDetailExportStatus('カテゴリが見つかりませんでした', 'error');
    return;
  }

  const metas = await getAllArticleMeta(db);
  const targetMetas = metas
    .filter(meta => meta.status === 'success' && meta.categoryId === categoryId)
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  if (targetMetas.length === 0) {
    setCategoryDetailExportStatus('出力対象の記事がありません', 'warn');
    return;
  }

  const entries = [];
  let skippedCount = 0;
  for (const meta of targetMetas) {
    const bodyRecord = await getArticleBody(db, meta.id);
    if (!bodyRecord || !bodyRecord.body) {
      skippedCount += 1;
      continue;
    }
    entries.push({ meta, body: bodyRecord.body });
  }

  if (entries.length === 0) {
    setCategoryDetailExportStatus('出力対象の記事に本文データが見つかりませんでした', 'error');
    return;
  }

  const markdown = buildCategoryMarkdown(category.name, entries);
  const filename = `${sanitizeFileName(category.name)}_${formatDateForFilename(new Date())}.md`;

  try {
    downloadBlob(markdown, filename, 'text/markdown');
  } catch {
    setCategoryDetailExportStatus('書き出しに失敗しました', 'error');
    return;
  }

  for (const entry of entries) {
    await setExported(db, entry.meta.id);
  }

  const skipNote = skippedCount > 0 ? `（本文データが見つからず${skippedCount}件をスキップしました）` : '';
  setCategoryDetailExportStatus(`${entries.length}件をMarkdownとして書き出しました${skipNote}`, 'success');

  await renderAll();
}

/**
 * カテゴリのMarkdown文字列を組み立てる。
 * @param {string} categoryName
 * @param {{ meta: object, body: string }[]} entries
 * @returns {string}
 */
function buildCategoryMarkdown(categoryName, entries) {
  const parts = [
    `# ${categoryName}`,
    '',
    `作成日: ${formatDateForFilename(new Date())}`,
    `記事数: ${entries.length}`,
    '',
    '---',
    '',
  ];

  entries.forEach(({ meta, body }, i) => {
    parts.push(`## ${meta.title}`);
    parts.push('');
    parts.push(`- URL: ${meta.originalUrl}`);
    parts.push(`- ドメイン: ${meta.domain}`);
    parts.push('');
    parts.push(body);
    if (i < entries.length - 1) {
      parts.push('');
      parts.push('---');
      parts.push('');
    }
  });

  return parts.join('\n') + '\n';
}

/**
 * カテゴリ名をファイル名として安全な文字列に変換する。
 * @param {string} name
 * @returns {string}
 */
function sanitizeFileName(name) {
  const sanitized = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '_');
  return sanitized === '' ? 'category' : sanitized;
}

function formatDateForFilename(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function setCategoryDetailExportStatus(message, type) {
  setStatus(categoryDetailExportStatus, message, type);
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
  setStatus(categorySheetStatus, message, type);
}

// -----------------------------------------------
// 記事カード一覧
// -----------------------------------------------
async function renderArticleList() {
  const metas = await getAllArticleMeta(db);
  const successMetas = metas
    .filter(meta => meta.status === 'success')
    .sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));

  const filteredMetas = successMetas.filter((meta) => {
    if (currentCategoryFilter === 'all') {
      return true;
    }
    if (currentCategoryFilter === 'unclassified') {
      return !meta.categoryId;
    }
    return meta.categoryId === currentCategoryFilter;
  });

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

  if (filteredMetas.length === 0 && fetchingItems.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = '該当する記事はありません';
    articleListEl.appendChild(p);
    return;
  }

  for (const meta of filteredMetas) {
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
    ${buildExportedBadge(meta)}
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
  setStatus(importStatus, message, type);
}

// success メッセージの自動消去タイマーを要素ごとに管理する
const statusAutoClearTimers = new WeakMap();

/**
 * ステータス表示用要素にメッセージを設定する。
 * type === 'success' の場合は2.5秒後に自動でメッセージを消す。
 * @param {HTMLElement} el
 * @param {string} message
 * @param {string} type
 */
function setStatus(el, message, type) {
  const existingTimer = statusAutoClearTimers.get(el);
  if (existingTimer) {
    clearTimeout(existingTimer);
    statusAutoClearTimers.delete(el);
  }

  el.textContent = message;
  el.className = `status-text${type ? ` status-${type}` : ''}`;

  if (type === 'success' && message) {
    const timer = setTimeout(() => {
      el.textContent = '';
      el.className = 'status-text';
      statusAutoClearTimers.delete(el);
    }, 2500);
    statusAutoClearTimers.set(el, timer);
  }
}
