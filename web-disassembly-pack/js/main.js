import { fetchResource } from './fetch.js';
import { parseHtml } from './parse.js';
import { extractCategoryExcerpts, detectJsFeatures, orderSourcesBySize } from './excerpt.js';
import { CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from './keywords.js';
import { detectLibraries } from './libraries.js';
import { checkDangerousContent } from './danger-check.js';
import { buildMarkdown } from './markdown.js';
import { buildInlineEntry, truncateForAnalysis } from './coverage.js';
import { MAX_CSS_FILES, MAX_JS_FILES, APP_VERSION } from './constants.js';

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

// 実行中の取得・解析の識別番号。clearResults() のたびに進めることで、
// やり直し・新しいURLの取得より前に始まった処理の結果を、画面と状態に書き込ませない。
let runId = 0;

function beginRun() {
  runId += 1;
  return runId;
}

function isCurrentRun(id) {
  return id === runId;
}

/**
 * 取得・解析の実行中かどうかで、操作ボタンの状態を切り替える。
 * 実行中は「URLを取得」「構造を見る」「Markdownを作る」を押せないようにする。
 */
function setBusy(busy) {
  fetchBtn.disabled = busy;
  structureBtn.disabled = busy;
  markdownBtn.disabled = busy;
  structureBtn.textContent = busy && !stepStructure.hidden ? '解析中...' : '構造を見る';
}

// -----------------------------------------------
// イベント登録
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);
structureBtn.addEventListener('click', handleStructure);
markdownBtn.addEventListener('click', handleMarkdown);
copyBtn.addEventListener('click', handleCopy);
saveBtn.addEventListener('click', handleSave);
resetBtn.addEventListener('click', handleReset);

// URLパラメータ対応: ?url= または ?text= でURLが渡された場合、入力欄に反映する。
// 共有ターゲット経由では text パラメータにURLが入る場合もあるため、
// url が無ければ text の中からURLらしき文字列を探す。
(function applySharedUrl() {
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url') || '';
  const textParam = params.get('text') || '';

  let candidate = urlParam.trim();

  if (!candidate && textParam) {
    const urlInText = textParam.match(/https?:\/\/[^\s]+/);
    if (urlInText) {
      candidate = urlInText[0];
    }
  }

  if (candidate) {
    urlInput.value = candidate;
  }
}());

// バージョン表示（定数から読み取り）
document.querySelectorAll('[data-app-version]').forEach((el) => {
  el.textContent = APP_VERSION;
});

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

  clearResults();
  const id = beginRun();
  setBusy(true);
  fetchStatus.textContent = '取得中...';

  let result;
  try {
    result = await fetchResource(normalizedUrl);
  } catch {
    result = { ok: false, reason: 'network' };
  }

  // 取得中に「やり直す」が押された場合、この結果は捨てる
  if (!isCurrentRun(id)) return;

  setBusy(false);

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
  // 前回の解析結果（生成済みMarkdownを含む）を消し、取得済みのHTMLだけを残す
  const { pageUrl, finalUrl, html } = state;
  if (typeof html !== 'string') return;
  state = { pageUrl, finalUrl, html };
  clearAnalysisOutputs();

  const id = beginRun();
  setBusy(true);

  try {
    await runStructureAnalysis(id);
  } catch {
    if (isCurrentRun(id)) {
      analyzedUrlEl.textContent = '解析中にエラーが発生しました。もう一度「構造を見る」を押してください。';
    }
  } finally {
    // やり直し・新しい取得で無効になった解析は、ボタン状態に触らない
    if (isCurrentRun(id)) setBusy(false);
  }
}

async function runStructureAnalysis(id) {
  const parsed = parseHtml(state.html, state.pageUrl);
  state.title = parsed.title;
  state.structure = parsed.structure;

  analyzedUrlEl.textContent = `解析対象: ${state.pageUrl}`;
  renderStructureCards(parsed.structure);

  state.inlineStyles = parsed.inlineStyles.map((text, i) => buildInlineEntry(text, `インラインstyle #${i + 1}`));
  state.inlineScripts = parsed.inlineScripts.map((text, i) => buildInlineEntry(text, `インラインscript #${i + 1}`));

  const cssResources = await buildResourceEntries(parsed.cssLinks, MAX_CSS_FILES);
  if (!isCurrentRun(id)) return;
  state.cssResources = cssResources;

  const jsResources = await buildResourceEntries(parsed.jsScripts, MAX_JS_FILES);
  if (!isCurrentRun(id)) return;
  state.jsResources = jsResources;

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
 * インライン・外部をまとめ、元の文字数が小さいものから順に並べる。
 * インラインに巨大なライブラリ本体が埋め込まれているページでも、
 * 小さなページ本体のscriptが先に抜粋の枠を使えるようにする。
 * ライブラリ判定による除外はしない（誤って本体を外さないため）。
 *
 * 注意: 抜粋はファイルごと・キーワードごとに最初の1か所だけを取るため、
 * 並べ替えだけでは大きなファイル由来の抜粋の偏りは解消しきれない。
 */
function collectJsSourcesForExcerpts() {
  const inline = state.inlineScripts.map((entry, i) => ({
    label: `インラインscript #${i + 1}`,
    text: entry.rawText,
    size: entry.size,
  }));

  const external = state.jsResources
    .filter((entry) => entry.status === 'ok')
    .map((entry) => ({ label: entry.label, text: entry.rawText, size: entry.size }));

  return orderSourcesBySize([...inline, ...external]);
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

    // size（元の文字数）・analyzedChars（解析した文字数）・truncated を残し、
    // Markdownの「取得・解析範囲」で切り詰めを明示できるようにする。
    entries.push({
      label: link.url,
      status: 'ok',
      ...truncateForAnalysis(result.content),
    });
  }

  return entries;
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
  // 解析が完了していない状態ではMarkdownを作らない
  if (!state.structure || !state.dangerFindings) return;

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
    htmlChars: (state.html || '').length,
    inlineStyles: state.inlineStyles,
    inlineScripts: state.inlineScripts,
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
  // 実行中だった取得・解析は clearResults() で無効になり、ボタンを戻さないため、ここで戻す
  setBusy(false);
}

/**
 * 構造解析・危険情報チェック・Markdownなど、URLごとの解析結果をすべて消去する。
 * 新しいURLを取得したとき、および「やり直す」を押したときに呼ぶ。
 * これにより、表示中の内容が必ず現在のURLに対応するようにする。
 */
function clearResults() {
  state = {};
  // 実行中の取得・解析を無効にする（その結果は画面と状態に書き込まれない）
  beginRun();

  clearAnalysisOutputs();

  hideStep(stepStructure);
  hideStep(stepDanger);
  hideStep(stepMarkdown);
}

/**
 * 解析結果の表示（構造・ライブラリ・JS検出・危険情報・Markdown）を消す。
 * 取得済みのHTMLは残すため、「構造を見る」の再実行時にも使う。
 */
function clearAnalysisOutputs() {
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
