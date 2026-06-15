import { fetchResource } from './fetch.js';
import { parseHtml } from './parse.js';
import { extractCategoryExcerpts, detectJsFeatures } from './excerpt.js';
import { CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from './keywords.js';
import { detectLibraries } from './libraries.js';
import { checkDangerousContent } from './danger-check.js';
import { buildMarkdown } from './markdown.js';
import { MAX_CSS_FILES, MAX_JS_FILES, MAX_RESOURCE_CHARS } from './constants.js';

// -----------------------------------------------
// DOM要素
// -----------------------------------------------
const urlInput = document.getElementById('url-input');
const fetchBtn = document.getElementById('fetch-btn');
const fetchStatus = document.getElementById('fetch-status');

const stepStructure = document.getElementById('step-structure');
const structureBtn = document.getElementById('structure-btn');
const analyzedUrlEl = document.getElementById('analyzed-url');
const structureCards = document.getElementById('structure-cards');
const libraryList = document.getElementById('library-list');
const jsFeatureList = document.getElementById('js-feature-list');
const structureNextHint = document.getElementById('structure-next-hint');

const stepDanger = document.getElementById('step-danger');
const dangerResult = document.getElementById('danger-result');

const stepMarkdown = document.getElementById('step-markdown');
const markdownBtn = document.getElementById('markdown-btn');
const markdownPreviewWrap = document.getElementById('markdown-preview-wrap');
const markdownPreview = document.getElementById('markdown-preview');
const copyBtn = document.getElementById('copy-btn');
const saveBtn = document.getElementById('save-btn');
const copyStatus = document.getElementById('copy-status');

const resetBtn = document.getElementById('reset-btn');

// -----------------------------------------------
// 状態（1ページ分の解析結果。永続化はしない）
// -----------------------------------------------
let state = {};

// -----------------------------------------------
// イベント登録
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);
structureBtn.addEventListener('click', handleStructure);
markdownBtn.addEventListener('click', handleMarkdown);
copyBtn.addEventListener('click', handleCopy);
saveBtn.addEventListener('click', handleSave);
resetBtn.addEventListener('click', handleReset);

// -----------------------------------------------
// 1. URLを取得
// -----------------------------------------------
async function handleFetch() {
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    fetchStatus.textContent = 'URLを入力してください。';
    return;
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(rawUrl).href;
  } catch {
    fetchStatus.textContent = 'URLの形式が正しくありません。';
    return;
  }

  fetchBtn.disabled = true;
  fetchStatus.textContent = '取得中...';
  clearResults();

  const result = await fetchResource(normalizedUrl);

  fetchBtn.disabled = false;

  if (!result.ok) {
    fetchStatus.textContent = `取得に失敗しました（${describeFailure(result)}）`;
    return;
  }

  state = {
    pageUrl: normalizedUrl,
    finalUrl: result.finalUrl || normalizedUrl,
    html: result.content,
  };

  fetchStatus.textContent = `取得しました（${result.content.length}文字）`;
  showStep(stepStructure);
}

// -----------------------------------------------
// 2. 構造を見る
// -----------------------------------------------
async function handleStructure() {
  structureBtn.disabled = true;
  structureBtn.textContent = '解析中...';

  const parsed = parseHtml(state.html, state.pageUrl);
  state.title = parsed.title;
  state.structure = parsed.structure;

  analyzedUrlEl.textContent = `解析対象: ${state.pageUrl}`;
  renderStructureCards(parsed.structure);

  state.inlineStyles = parsed.inlineStyles.map((text) => buildInlineEntry(text));
  state.inlineScripts = parsed.inlineScripts.map((text) => buildInlineEntry(text));

  state.cssResources = await buildResourceEntries(parsed.cssLinks, MAX_CSS_FILES);
  state.jsResources = await buildResourceEntries(parsed.jsScripts, MAX_JS_FILES);

  const jsTexts = collectJsTexts();
  state.jsFeatures = detectJsFeatures(jsTexts);
  state.libraries = detectLibraries({
    scriptUrls: parsed.jsScripts.map((script) => script.url),
    texts: jsTexts,
  });
  renderJsFeatureList(state.jsFeatures);
  renderLibraryList(state.libraries);

  state.cssExcerpts = extractCategoryExcerpts(collectCssSources(), CSS_EXCERPT_CATEGORIES);
  state.jsExcerpts = extractCategoryExcerpts(collectJsSourcesForExcerpts(), JS_EXCERPT_CATEGORIES);

  state.dangerFindings = checkDangerousContent(collectDangerCheckSources());
  renderDangerResult(state.dangerFindings);

  structureBtn.disabled = false;
  structureBtn.textContent = '構造を見る';

  structureNextHint.hidden = false;
  showStep(stepDanger);
  showStep(stepMarkdown);
}

function collectJsTexts() {
  const texts = state.inlineScripts.map((entry) => entry.rawText);
  state.jsResources
    .filter((entry) => entry.status === 'ok')
    .forEach((entry) => texts.push(entry.rawText));
  return texts;
}

function collectCssSources() {
  const sources = state.inlineStyles.map((entry, i) => ({
    label: `インラインstyle #${i + 1}`,
    text: entry.rawText,
  }));

  state.cssResources
    .filter((entry) => entry.status === 'ok')
    .forEach((entry) => sources.push({ label: entry.label, text: entry.rawText }));

  return sources;
}

/**
 * JavaScript抜粋用のソース一覧を作る。
 *
 * インラインscript（ページ固有のコードである可能性が高い）を先頭に置き、
 * 外部JSはサイズが小さいものから順に並べることで、巨大なライブラリ本体に
 * 抜粋が埋め尽くされず、ページ本体の処理らしいscriptが優先されるようにする。
 */
function collectJsSourcesForExcerpts() {
  const inline = state.inlineScripts.map((entry, i) => ({
    label: `インラインscript #${i + 1}`,
    text: entry.rawText,
    size: entry.size,
  }));

  const external = state.jsResources
    .filter((entry) => entry.status === 'ok')
    .map((entry) => ({ label: entry.label, text: entry.rawText, size: entry.size }))
    .sort((a, b) => a.size - b.size);

  return [...inline, ...external];
}

function collectDangerCheckSources() {
  const sources = [{ label: 'HTML', text: state.html }];

  state.inlineStyles.forEach((entry, i) => {
    sources.push({ label: `インラインstyle #${i + 1}`, text: entry.rawText });
  });
  state.inlineScripts.forEach((entry, i) => {
    sources.push({ label: `インラインscript #${i + 1}`, text: entry.rawText });
  });
  state.cssResources
    .filter((entry) => entry.status === 'ok')
    .forEach((entry) => sources.push({ label: entry.label, text: entry.rawText }));
  state.jsResources
    .filter((entry) => entry.status === 'ok')
    .forEach((entry) => sources.push({ label: entry.label, text: entry.rawText }));

  return sources;
}

/**
 * 外部CSS/JSの一覧から、取得対象（同一オリジン・件数上限内）のみWorker経由で取得する。
 * 対象外・失敗のものはその旨を記録する（「取得対象外の記録」セクションに使う）。
 */
async function buildResourceEntries(links, maxCount) {
  const entries = [];
  let fetchedCount = 0;

  for (const link of links) {
    if (!link.sameOrigin) {
      entries.push({ label: link.url, status: 'skipped_external' });
      continue;
    }

    if (fetchedCount >= maxCount) {
      entries.push({ label: link.url, status: 'skipped_limit' });
      continue;
    }

    fetchedCount += 1;
    const result = await fetchResource(link.url);

    if (!result.ok) {
      entries.push({ label: link.url, status: 'failed', reason: describeFailure(result) });
      continue;
    }

    const text = result.content;
    const truncated = text.length > MAX_RESOURCE_CHARS;
    const processedText = truncated ? text.slice(0, MAX_RESOURCE_CHARS) : text;

    entries.push({
      label: link.url,
      status: 'ok',
      size: text.length,
      truncated,
      rawText: processedText,
    });
  }

  return entries;
}

function buildInlineEntry(text) {
  const truncated = text.length > MAX_RESOURCE_CHARS;
  const processedText = truncated ? text.slice(0, MAX_RESOURCE_CHARS) : text;

  return {
    size: text.length,
    rawText: processedText,
  };
}

function describeFailure(result) {
  switch (result.reason) {
    case 'network':
      return '通信エラー';
    case 'too_large':
      return 'サイズが大きすぎます';
    case 'http_error':
      return `HTTPエラー${result.httpStatus ? ' ' + result.httpStatus : ''}`;
    default:
      return '不明なエラー';
  }
}

// -----------------------------------------------
// 表示
// -----------------------------------------------
function renderStructureCards(structure) {
  const items = [
    ['canvas', structure.canvas],
    ['button', structure.button],
    ['audio', structure.audio],
    ['video', structure.video],
    ['svg', structure.svg],
    ['script(インライン)', structure.inlineScriptCount],
    ['script(外部)', structure.externalScriptCount],
    ['style(インライン)', structure.inlineStyleCount],
    ['stylesheet(外部)', structure.externalStylesheetCount],
  ];

  structureCards.innerHTML = '';
  for (const [label, value] of items) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="card-value">${value}</div><div class="card-label">${escapeHtml(label)}</div>`;
    structureCards.appendChild(card);
  }
}

const VALUE_CLASS_MAP = {
  'あり': 'feature-item-found',
  'なし': 'feature-item-not-found',
  '特定できず': 'feature-item-unclear',
  '未確認': 'feature-item-unknown',
};

function renderFeatureList(listEl, items) {
  listEl.innerHTML = '';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'feature-item';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;

    const valueSpan = document.createElement('span');
    valueSpan.textContent = item.value;
    valueSpan.className = VALUE_CLASS_MAP[item.value] || 'feature-item-unknown';

    li.appendChild(labelSpan);
    li.appendChild(valueSpan);
    listEl.appendChild(li);
  }
}

function renderJsFeatureList(features) {
  renderFeatureList(jsFeatureList, features);
}

function renderLibraryList(libraries) {
  renderFeatureList(libraryList, libraries);
}

function renderDangerResult(findings) {
  dangerResult.innerHTML = '';

  if (!findings || findings.length === 0) {
    dangerResult.classList.remove('card-warning');
    dangerResult.textContent = 'チェック対象のパターンは検出されませんでした。';
    return;
  }

  dangerResult.classList.add('card-warning');

  const list = document.createElement('ul');
  for (const finding of findings) {
    const li = document.createElement('li');
    li.textContent = `[${finding.label}] ${finding.type}: ${finding.preview}`;
    list.appendChild(li);
  }
  dangerResult.appendChild(list);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// -----------------------------------------------
// 3. Markdownを作る / コピーする / .mdを保存
// -----------------------------------------------
function handleMarkdown() {
  state.markdown = buildMarkdown({
    pageUrl: state.pageUrl,
    finalUrl: state.finalUrl,
    title: state.title,
    structure: state.structure,
    jsFeatures: state.jsFeatures,
    libraries: state.libraries,
    cssExcerpts: state.cssExcerpts,
    jsExcerpts: state.jsExcerpts,
    cssResources: state.cssResources,
    jsResources: state.jsResources,
    dangerFindings: state.dangerFindings,
  });

  markdownPreview.value = state.markdown;
  markdownPreviewWrap.hidden = false;
  copyStatus.textContent = '';
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(state.markdown || '');
    copyStatus.textContent = 'コピーしました。';
  } catch {
    copyStatus.textContent = 'コピーに失敗しました。テキストを選択してコピーしてください。';
    markdownPreview.focus();
    markdownPreview.select();
  }
}

function handleSave() {
  const blob = new Blob([state.markdown || ''], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = buildFileName(state.pageUrl);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function buildFileName(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `web-disassembly-pack-${host}.md`;
  } catch {
    return 'web-disassembly-pack.md';
  }
}

// -----------------------------------------------
// やり直す
// -----------------------------------------------
function handleReset() {
  urlInput.value = '';
  fetchStatus.textContent = '';
  clearResults();
}

/**
 * 構造解析・危険情報チェック・Markdownなど、URLごとの解析結果をすべて消去する。
 * 新しいURLを取得したとき、および「やり直す」を押したときに呼ぶ。
 * これにより、表示中の内容が必ず現在のURLに対応するようにする。
 */
function clearResults() {
  state = {};

  analyzedUrlEl.textContent = '';
  structureCards.innerHTML = '';
  libraryList.innerHTML = '';
  jsFeatureList.innerHTML = '';
  structureNextHint.hidden = true;

  dangerResult.innerHTML = '';
  dangerResult.classList.remove('card-warning');

  markdownPreview.value = '';
  markdownPreviewWrap.hidden = true;
  copyStatus.textContent = '';

  hideStep(stepStructure);
  hideStep(stepDanger);
  hideStep(stepMarkdown);
}

// -----------------------------------------------
// 共通
// -----------------------------------------------
function showStep(el) {
  el.hidden = false;
}

function hideStep(el) {
  el.hidden = true;
}
