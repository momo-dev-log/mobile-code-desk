import {
  openDb,
  recoverOrphanedFetches,
  getAllArticleMeta,
  getArticleMeta,
  getArticleBody,
  putArticleMeta,
  putArticleMetaAndBody,
  deleteArticle,
  getOrCreatePack,
  putPack,
  DEFAULT_PACK_NAME,
} from './db.js';
import { normalizeUrl } from './normalize.js';
import { fetchArticleHtml } from './fetch.js';
import { extractArticle } from './extract.js';
import { parseSitemap, looksLikeSitemapUrl, getSitemapCandidates } from './sitemap.js';
import { scoreArticles } from './scorer.js';
import { buildPackMarkdown, markdownToPlainText, generateFilename, sanitizePackName } from './markdown.js';
import {
  SHORT_BODY_THRESHOLD,
  BODY_TOO_LARGE_CHARS,
  PACK_WARN_THRESHOLD,
  PREVIEW_CHARS,
  MAX_SITEMAP_URLS,
  RELEVANCE_HIGH_MIN_HITS,
  RELEVANCE_MID_MIN_HITS,
} from './constants.js';

let db;
let pack;

// 立ち読み展開中のID（表示のみ。永続化しない）
const expandedIds = new Set();

// 現在の検索キーワード
let searchQuery = '';

// 仕上げで生成済みのMarkdown/txt（ダウンロード用に保持）
let generatedFiles = null;

// 複数URL取り込み確認待ちのID一覧
let pendingFetchIds = [];

// sitemap展開で見つかったURL一覧（チェックボックスのインデックス対応用）
let sitemapUrls = [];

// -----------------------------------------------
// DOM要素
// -----------------------------------------------
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

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

const sitemapSectionEl = document.getElementById('sitemap-section');
const sitemapStatusEl = document.getElementById('sitemap-status');
const sitemapIndexListEl = document.getElementById('sitemap-index-list');
const sitemapUrlListSectionEl = document.getElementById('sitemap-url-list-section');
const sitemapUrlListEl = document.getElementById('sitemap-url-list');
const sitemapSelectAllBtn = document.getElementById('sitemap-select-all-btn');
const sitemapDeselectAllBtn = document.getElementById('sitemap-deselect-all-btn');
const sitemapImportBtn = document.getElementById('sitemap-import-btn');

const articleListEl = document.getElementById('article-card-list');

const packCountEl = document.getElementById('pack-count');
const packWarnEl = document.getElementById('pack-warn');
const packListEl = document.getElementById('pack-list');
const finishBtn = document.getElementById('finish-btn');
const tabPackBadgeEl = document.getElementById('tab-pack-badge');

const packNameInput = document.getElementById('pack-name-input');
const txtCheckbox = document.getElementById('txt-checkbox');
const buildBtn = document.getElementById('build-btn');
const saveBtn = document.getElementById('save-btn');
const buildStatus = document.getElementById('build-status');

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

  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  urlFoldToggle.addEventListener('click', () => {
    const isOpen = !urlFoldBody.hidden;
    urlFoldBody.hidden = isOpen;
    urlFoldArrow.textContent = isOpen ? '▸' : '▾';
  });

  importBtn.addEventListener('click', handleImport);
  importConfirmFetchBtn.addEventListener('click', handleImportConfirmFetch);

  sitemapSelectAllBtn.addEventListener('click', () => setSitemapCheckboxes(true));
  sitemapDeselectAllBtn.addEventListener('click', () => setSitemapCheckboxes(false));
  sitemapImportBtn.addEventListener('click', handleSitemapImport);

  finishBtn.addEventListener('click', () => switchTab('finish'));
  buildBtn.addEventListener('click', handleBuildPack);
  saveBtn.addEventListener('click', handleSaveFiles);

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
  if (tabName === 'finish') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// -----------------------------------------------
// 検索
// -----------------------------------------------
async function handleSearch() {
  searchQuery = searchInput.value;
  await renderArticleList();
}

// -----------------------------------------------
// 取り込み（さがすタブ）
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

  if (validUrls.length === 1) {
    const single = validUrls[0];
    if (looksLikeSitemapUrl(single)) {
      // 明示的なsitemap URL（.xml または "sitemap" を含む）はそのまま展開する
      urlTextarea.value = '';
      await handleSitemapCandidate(single);
      return;
    }
    if (isSiteRootUrl(single)) {
      // サイトのトップURL → sitemapを自動探索して展開する
      urlTextarea.value = '';
      await handleSiteUrlAutoDiscover(single);
      return;
    }
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
// sitemap展開
// -----------------------------------------------

/**
 * 入力URLがサイトのトップ（オリジン直下）かどうかを判定する。
 * パスが "/" または空で、クエリ・フラグメントを持たない場合に true。
 * @param {string} urlStr
 * @returns {boolean}
 */
function isSiteRootUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/**
 * サイトのトップURLから sitemap を自動探索する（v1/app.js の handleSitemapFetch 相当）。
 * /sitemap.xml → /sitemap_index.xml → /wp-sitemap.xml の順に試行し、
 * 最初に解析できた sitemap を展開する。
 * sitemapindex の場合は既存の子sitemap選択UI（showSitemapIndexList）に乗せる。
 * @param {string} siteUrl
 */
async function handleSiteUrlAutoDiscover(siteUrl) {
  sitemapSectionEl.hidden = false;
  sitemapIndexListEl.hidden = true;
  sitemapUrlListSectionEl.hidden = true;
  sitemapStatusEl.textContent = 'サイトのsitemapを自動探索しています…';
  sitemapStatusEl.className = 'status-text';

  let candidates;
  try {
    candidates = getSitemapCandidates(siteUrl);
  } catch {
    sitemapStatusEl.textContent = 'URLの形式が正しくありません';
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  for (const candidate of candidates) {
    sitemapStatusEl.textContent = `試行中: ${candidate}`;
    sitemapStatusEl.className = 'status-text';

    const result = await fetchArticleHtml(candidate);
    if (!result.ok) continue;

    const parsed = parseSitemap(result.html);
    if (!parsed) continue;

    if (parsed.type === 'sitemapindex' && parsed.urls.length > 0) {
      showSitemapIndexList(parsed.urls);
      return;
    }
    if (parsed.type === 'urlset' && parsed.urls.length > 0) {
      showSitemapUrlList(parsed.urls);
      return;
    }
    // URL候補0件の候補は次へ
  }

  sitemapStatusEl.textContent =
    'sitemapが見つかりませんでした（/sitemap.xml /sitemap_index.xml /wp-sitemap.xml を試しました）';
  sitemapStatusEl.className = 'status-text status-error';
}

async function handleSitemapCandidate(url) {
  sitemapSectionEl.hidden = false;
  sitemapIndexListEl.hidden = true;
  sitemapUrlListSectionEl.hidden = true;
  sitemapStatusEl.textContent = 'sitemapを確認しています…';
  sitemapStatusEl.className = 'status-text';

  const result = await fetchArticleHtml(url);
  if (!result.ok) {
    sitemapStatusEl.textContent = `sitemapを取得できませんでした: ${describeFailReason(classifyFailReason(result), result.httpStatus)}`;
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  const parsed = parseSitemap(result.html);
  if (!parsed) {
    sitemapStatusEl.textContent = 'sitemapとして解析できませんでした';
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  if (parsed.type === 'sitemapindex') {
    showSitemapIndexList(parsed.urls);
    return;
  }

  showSitemapUrlList(parsed.urls);
}

function showSitemapIndexList(childUrls) {
  sitemapIndexListEl.hidden = false;
  sitemapUrlListSectionEl.hidden = true;
  sitemapStatusEl.textContent = `子sitemapが${childUrls.length}件見つかりました。展開する1件を選んでください`;
  sitemapStatusEl.className = 'status-text';

  sitemapIndexListEl.innerHTML = '';
  for (const childUrl of childUrls) {
    const div = document.createElement('div');
    div.className = 'sitemap-index-item';
    div.innerHTML = `
      <span class="sitemap-index-url">${escapeHtml(childUrl)}</span>
      <button type="button" class="btn btn-small btn-expand-child">展開</button>
    `;
    div.querySelector('.btn-expand-child').addEventListener('click', () => expandChildSitemap(childUrl));
    sitemapIndexListEl.appendChild(div);
  }
}

async function expandChildSitemap(url) {
  sitemapStatusEl.textContent = 'sitemapを確認しています…';
  sitemapStatusEl.className = 'status-text';

  const result = await fetchArticleHtml(url);
  if (!result.ok) {
    sitemapStatusEl.textContent = `sitemapを取得できませんでした: ${describeFailReason(classifyFailReason(result), result.httpStatus)}`;
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  const parsed = parseSitemap(result.html);
  if (!parsed || parsed.type !== 'urlset') {
    sitemapStatusEl.textContent = '多段の入れ子sitemapには対応していません';
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  showSitemapUrlList(parsed.urls);
}

function showSitemapUrlList(urls) {
  let truncated = false;
  if (urls.length > MAX_SITEMAP_URLS) {
    urls = urls.slice(0, MAX_SITEMAP_URLS);
    truncated = true;
  }

  sitemapUrls = urls;
  sitemapIndexListEl.hidden = true;
  sitemapUrlListSectionEl.hidden = false;

  sitemapStatusEl.textContent = `${urls.length}件のURLが見つかりました${truncated ? '（200件で打ち切りました）' : ''}`;
  sitemapStatusEl.className = truncated ? 'status-text status-warn' : 'status-text';

  sitemapUrlListEl.innerHTML = '';
  urls.forEach((u, i) => {
    const li = document.createElement('li');
    li.className = 'sitemap-url-item';
    li.innerHTML = `
      <label>
        <input type="checkbox" class="sitemap-url-checkbox" data-index="${i}" checked>
        <span class="sitemap-url-text">${escapeHtml(u)}</span>
      </label>
    `;
    sitemapUrlListEl.appendChild(li);
  });
}

function setSitemapCheckboxes(checked) {
  sitemapUrlListEl.querySelectorAll('.sitemap-url-checkbox').forEach((cb) => {
    cb.checked = checked;
  });
}

async function handleSitemapImport() {
  const checked = [...sitemapUrlListEl.querySelectorAll('.sitemap-url-checkbox:checked')]
    .map(cb => sitemapUrls[Number(cb.dataset.index)]);

  if (checked.length === 0) {
    sitemapStatusEl.textContent = 'URLを選択してください';
    sitemapStatusEl.className = 'status-text status-error';
    return;
  }

  sitemapSectionEl.hidden = true;

  const { createdCount, duplicateCount, createdIds } = await importUrls(checked);
  await finishImport(createdCount, duplicateCount, createdIds);
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
// URL一覧からの削除
// -----------------------------------------------
async function handleDeleteArticle(id) {
  await deleteArticle(db, id);
  expandedIds.delete(id);
  await renderAll();
}

// -----------------------------------------------
// 立ち読み
// -----------------------------------------------
async function togglePreview(id) {
  const wasExpanded = expandedIds.has(id);
  if (wasExpanded) {
    expandedIds.delete(id);
  } else {
    expandedIds.add(id);
  }
  await renderAll();

  if (wasExpanded) {
    const card = articleListEl.querySelector(`[data-article-id="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
// 関連度カード一覧
// -----------------------------------------------
async function renderArticleList() {
  const metas = await getAllArticleMeta(db);
  const query = searchQuery.trim();
  const queryWords = query ? [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))] : [];

  let cards;

  if (queryWords.length === 0) {
    metas.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    cards = metas.map(meta => ({ meta, score: 0, highlights: [], body: null }));
  } else {
    const fetched = metas.filter(m => m.fetchState === 'fetched');
    const others = metas.filter(m => m.fetchState !== 'fetched');

    const scoringInput = [];
    const bodyMap = new Map();
    for (const meta of fetched) {
      const bodyRecord = await getArticleBody(db, meta.id);
      const body = bodyRecord ? bodyRecord.body : '';
      bodyMap.set(meta.id, body);
      scoringInput.push({ id: meta.id, title: meta.title, body });
    }
    const scores = scoreArticles(query, scoringInput);

    const matched = fetched
      .map(meta => {
        const { score, highlights } = scores.get(meta.id);
        return { meta, score, highlights, body: bodyMap.get(meta.id) };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.meta.createdAt || '').localeCompare(a.meta.createdAt || ''));

    others.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const otherCards = others.map(meta => ({ meta, score: 0, highlights: [], body: null }));

    cards = [...matched, ...otherCards];
  }

  articleListEl.innerHTML = '';

  if (cards.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = query
      ? '該当する記事が見つかりませんでした'
      : 'まだURLが取り込まれていません';
    articleListEl.appendChild(p);
    return;
  }

  for (const item of cards) {
    const card = await buildArticleCard(item.meta, {
      score: item.score,
      highlights: item.highlights,
      queryWords,
      body: item.body,
    });
    articleListEl.appendChild(card);
  }
}

async function buildArticleCard(meta, searchInfo) {
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

    // 関連度バッジ・抜粋（検索クエリがある場合のみ）
    const relevanceHtml = buildRelevanceHtml(searchInfo);
    const excerptHtml = buildExcerptHtml(searchInfo);

    let previewAreaHtml = '';
    if (isExpanded) {
      const bodyRecord = await getArticleBody(db, meta.id);
      const bodyText = bodyRecord ? bodyRecord.body : '';
      const previewText = bodyText.slice(0, PREVIEW_CHARS);
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
      ${relevanceHtml}
      <p class="article-state">約${meta.charCount.toLocaleString('ja-JP')}字</p>
      ${warnHtml}
      ${excerptHtml}
      <div class="article-actions">
        ${addBtnHtml}
        ${isExpanded ? '' : previewBtnHtml}
        ${refetchBtnHtml}
      </div>
      ${previewAreaHtml}
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

/**
 * 関連度バッジ（高/中/低）のHTMLを構築する。
 * docs/spec.md 10章: 高/中/低の3段階。導出はUI側で行う。
 */
function buildRelevanceHtml(searchInfo) {
  if (!searchInfo || searchInfo.score === 0 || searchInfo.queryWords.length === 0) return '';

  const totalWords = searchInfo.queryWords.length;
  const matchedWordCount = Math.floor(searchInfo.score / 1000);
  const hitPart = searchInfo.score % 1000;
  const allMatched = matchedWordCount === totalWords;

  let level;
  let label;
  if (allMatched && hitPart >= RELEVANCE_HIGH_MIN_HITS) {
    level = 'high';
    label = '高';
  } else if (allMatched || hitPart >= RELEVANCE_MID_MIN_HITS) {
    level = 'mid';
    label = '中';
  } else {
    level = 'low';
    label = '低';
  }

  return `<p class="relevance-badge relevance-badge--${level}">関連度: ${label}</p>`;
}

/**
 * ヒット箇所の抜粋（キーワード強調付き）のHTMLを構築する。
 */
function buildExcerptHtml(searchInfo) {
  if (!searchInfo || searchInfo.highlights.length === 0 || !searchInfo.body) return '';

  const sorted = [...searchInfo.highlights].sort((a, b) => a.index - b.index);
  const first = sorted[0];

  const start = Math.max(0, first.index - 30);
  const end = Math.min(searchInfo.body.length, first.index + first.word.length + 100);

  let snippet = searchInfo.body.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < searchInfo.body.length) snippet += '…';

  const highlighted = highlightSnippet(snippet, searchInfo.queryWords);
  return `<p class="article-excerpt">${highlighted}</p>`;
}

function highlightSnippet(snippet, words) {
  let escaped = escapeHtml(snippet);
  for (const word of words) {
    if (!word) continue;
    const re = new RegExp(escapeRegExp(escapeHtml(word)), 'gi');
    escaped = escaped.replace(re, m => `<mark>${m}</mark>`);
  }
  return escaped;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const warnNote = meta.warnings.includes('short_body')
      ? ` <span class="article-warn-inline">⚠️ 約${meta.charCount.toLocaleString('ja-JP')}字</span>`
      : '';
    li.innerHTML = `
      <span class="pack-item-title truncate">${escapeHtml(meta.title)}</span>
      <span class="pack-item-domain truncate">${escapeHtml(meta.domain)}</span>${warnNote}
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

function setBuildStatus(message, type) {
  buildStatus.textContent = message;
  buildStatus.className = `status-text status-${type}`;
}
