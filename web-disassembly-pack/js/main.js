import { fetchResource } from './fetch.js';
import { parseHtml } from './parse.js';
import { extractCategoryExcerpts, detectJsFeatures, orderSourcesBySize } from './excerpt.js';
import { CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from './keywords.js';
import { detectLibraries } from './libraries.js';
import { checkDangerousContent } from './danger-check.js';
import { buildMarkdown, buildFullMarkdown } from './markdown.js';
import { buildInlineEntry, truncateForAnalysis } from './coverage.js';
import { MAX_CSS_FILES, MAX_JS_FILES, APP_VERSION } from './constants.js';
import {
  createFullFetchCache,
  planFullFetch,
  runFullFetch,
  resolveWithoutFetch,
  toFullResources,
  DEFAULT_FULL_FETCH_LIMITS,
} from './full-fetch.js';

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
const dangerExtraResult = document.getElementById('danger-extra-result');

const stepMarkdown = document.getElementById('step-markdown');
const markdownBtn = document.getElementById('markdown-btn');
const markdownFullBtn = document.getElementById('markdown-full-btn');
const markdownVariantEl = document.getElementById('markdown-variant');
const fullFetchStatusEl = document.getElementById('full-fetch-status');
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
 * 実行中は「URLを取得」「構造を見る」「Markdownを作る」「全文つきでMarkdownを作る」を押せないようにする。
 */
function setBusy(busy, { analyzing = true } = {}) {
  fetchBtn.disabled = busy;
  structureBtn.disabled = busy;
  markdownBtn.disabled = busy;
  markdownFullBtn.disabled = busy;
  structureBtn.textContent = busy && analyzing && !stepStructure.hidden ? '解析中...' : '構造を見る';
}

// -----------------------------------------------
// イベント登録
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);
structureBtn.addEventListener('click', handleStructure);
markdownBtn.addEventListener('click', () => handleMarkdown('summary'));
markdownFullBtn.addEventListener('click', handleFullMarkdown);
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
  const parsed = parseHtml(state.html, state.finalUrl || state.pageUrl);
  state.title = parsed.title;
  state.structure = parsed.structure;
  // 全文つき版の追加取得・記述順の一覧で使う（通常解析の処理と出力には使わない）
  state.cssLinks = parsed.cssLinks;
  state.jsScripts = parsed.jsScripts;
  state.scriptOrder = parsed.scriptOrder || [];

  analyzedUrlEl.textContent = `解析対象: ${state.pageUrl}`;
  renderStructureCards(parsed.structure);

  state.inlineStyles = parsed.inlineStyles.map((text, i) => buildInlineEntry(text, `インラインstyle #${i + 1}`));
  state.inlineScripts = parsed.inlineScripts.map((text, i) => buildInlineEntry(text, `インラインscript #${i + 1}`));

  const cssResources = await buildResourceEntries(parsed.cssLinks, MAX_CSS_FILES, id);
  if (!isCurrentRun(id)) return;
  state.cssResources = cssResources;

  const jsResources = await buildResourceEntries(parsed.jsScripts, MAX_JS_FILES, id);
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
 *
 * やり直し等で runId の解析が無効になったら、残りのファイルは取りに行かずに打ち切る。
 * 打ち切った結果は呼び出し側で捨てられる。進行中の1件の通信そのものは中断しない。
 */
async function buildResourceEntries(links, maxCount, id) {
  const entries = [];
  let fetchedCount = 0;

  for (const link of links) {
    if (!isCurrentRun(id)) break;

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
    if (!isCurrentRun(id)) break;

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
    case 'timeout':
      return 'タイムアウト';
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

/**
 * 全文つき版の追加取得分の危険情報チェック結果を、通常解析分とは別の欄に表示する。
 */
function renderExtraDangerResult(findings, checkedFiles) {
  dangerExtraResult.innerHTML = '';
  dangerExtraResult.hidden = false;

  const title = document.createElement('p');
  title.className = 'danger-extra-title';
  title.textContent = `全文つき版の追加取得分（${checkedFiles}件）`;
  dangerExtraResult.appendChild(title);

  if (checkedFiles === 0) {
    dangerExtraResult.classList.remove('card-warning');
    const p = document.createElement('p');
    p.textContent = '追加取得したファイルはありません。';
    dangerExtraResult.appendChild(p);
    return;
  }
  if (!findings || findings.length === 0) {
    dangerExtraResult.classList.remove('card-warning');
    const p = document.createElement('p');
    p.textContent = 'チェック対象のパターンは検出されませんでした。';
    dangerExtraResult.appendChild(p);
    return;
  }

  dangerExtraResult.classList.add('card-warning');
  const list = document.createElement('ul');
  for (const finding of findings) {
    const li = document.createElement('li');
    li.textContent = `[${finding.label}] ${finding.type}: ${finding.preview}`;
    list.appendChild(li);
  }
  dangerExtraResult.appendChild(list);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// -----------------------------------------------
// 3. Markdownを作る / コピーする / .mdを保存
// -----------------------------------------------
/**
 * Markdownを作る。
 * - 'summary': 通常版（「Markdownを作る」）
 * - 'full': 全文つき版（「全文つきでMarkdownを作る」。利用者が選んだときだけ本文を収録する）
 */
function handleMarkdown(variant) {
  // 解析が完了していない状態ではMarkdownを作らない
  if (!state.structure || !state.dangerFindings) return;

  const data = markdownData();
  const isFull = variant === 'full';
  state.markdown = isFull ? buildFullMarkdown({ ...data, html: state.html || '', full: fullMarkdownData() }) : buildMarkdown(data);
  state.markdownVariant = isFull ? 'full' : 'summary';

  markdownPreview.value = state.markdown;
  markdownVariantEl.textContent = isFull
    ? `全文つきのMarkdownです（${state.markdown.length}文字）。共有前に、機密情報が含まれていないか確認してください。`
    : `通常版のMarkdownです（${state.markdown.length}文字）。`;
  markdownPreviewWrap.hidden = false;
  copyStatus.textContent = '';
}

function markdownData() {
  return {
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
  };
}

// -----------------------------------------------
// 全文つきでMarkdownを作る（v0.4.1: 不足分の追加取得つき）
// -----------------------------------------------

/**
 * 「全文つきでMarkdownを作る」。
 *
 * 初回は、通常解析で取得しなかった同一オリジンのCSS/JSを、全文つき版の上限まで1件ずつ追加取得してから作る。
 * 取得に成功したファイルは保存して再利用する。失敗・タイムアウト・時間切れのものは次に押したときに再試行する。
 * 追加取得が要らないとき（すべて取得済み・上限に達している）は、通信せずにすぐ作る。
 * 追加取得の結果は state.fullFetch にだけ保存し、通常解析の結果（state.cssResources 等）は変えない。
 */
function handleFullMarkdown() {
  if (!state.structure || !state.dangerFindings) return undefined;

  if (!state.fullFetch) {
    state.fullFetch = { cache: createFullFetchCache(state.cssResources, state.jsResources), runs: [], result: null };
  }

  const plan = planFullFetch({ cssLinks: state.cssLinks, jsScripts: state.jsScripts, cache: state.fullFetch.cache });
  if (plan.attempts === 0) {
    state.fullFetch.result = resolveWithoutFetch(plan, state.fullFetch.cache);
    finishFullMarkdown();
    return undefined;
  }
  return fetchMissingThenBuild(plan.attempts);
}

async function fetchMissingThenBuild(plannedAttempts) {
  const id = beginRun();
  const { fullFetch } = state;
  setBusy(true, { analyzing: false });
  fullFetchStatusEl.textContent = `不足しているCSS/JSを追加取得しています（0/${plannedAttempts}件）...`;

  let run;
  try {
    run = await runFullFetch({
      cssLinks: state.cssLinks,
      jsScripts: state.jsScripts,
      cache: fullFetch.cache,
      fetchFn: (url, options) => fetchResource(url, options),
      isCancelled: () => !isCurrentRun(id),
      onProgress: ({ done, total }) => {
        if (isCurrentRun(id)) fullFetchStatusEl.textContent = `不足しているCSS/JSを追加取得しています（${done}/${total}件）...`;
      },
    });
  } catch {
    run = null;
  } finally {
    if (isCurrentRun(id)) setBusy(false);
  }

  // やり直し・再解析で無効になった取得は、画面にも状態にも書き込まない
  if (!isCurrentRun(id) || state.fullFetch !== fullFetch) return;
  if (!run || run.cancelled) {
    fullFetchStatusEl.textContent = '追加取得中にエラーが発生しました。もう一度「全文つきでMarkdownを作る」を押してください。';
    return;
  }

  fullFetch.runs.push({ log: run.log, stats: run.stats });
  fullFetch.result = run;
  finishFullMarkdown();
}

function finishFullMarkdown() {
  const { fullFetch } = state;
  const extras = [...fullFetch.cache.values()].filter((entry) => entry.source === 'extra');
  fullFetch.dangerFindings = checkDangerousContent(extras.map((entry) => ({ label: entry.label, text: entry.rawText })));
  fullFetch.extraFileCount = extras.length;
  renderExtraDangerResult(fullFetch.dangerFindings, extras.length);

  const { stats, retryable } = fullFetch.result;
  fullFetchStatusEl.textContent = describeFullFetchStatus(stats, retryable, fullFetch.result.fetched);
  handleMarkdown('full');
}

function describeFullFetchStatus(stats, retryable, fetched) {
  const parts = [];
  if (fetched) {
    parts.push(`追加取得: 通信${stats.attempts}件（成功${stats.okThisRun}件・失敗${stats.failed}件・タイムアウト${stats.timeout}件）`);
  } else {
    parts.push('追加取得: 通信なし（取得済みのファイルを使用）');
  }
  if (stats.skippedTime > 0) parts.push(`時間上限で未試行${stats.skippedTime}件`);
  if (stats.skippedBudget > 0) parts.push(`文字数上限で未試行${stats.skippedBudget}件`);
  if (stats.skippedLimit > 0) parts.push(`件数上限で未試行${stats.skippedLimit}件`);
  if (retryable) parts.push('取得できなかったファイルは、もう一度押すと再試行します');
  return `${parts.join('。')}。`;
}

/** 全文Markdownに渡す、追加取得を含む取得記録 */
function fullMarkdownData() {
  const { fullFetch } = state;
  const { candidates } = fullFetch.result;
  return {
    cssResources: toFullResources(candidates, fullFetch.cache, 'CSS'),
    jsResources: toFullResources(candidates, fullFetch.cache, 'JS'),
    candidates,
    runs: fullFetch.runs,
    lastRun: fullFetch.result,
    dangerFindings: fullFetch.dangerFindings,
    extraFileCount: fullFetch.extraFileCount,
    scriptOrder: state.scriptOrder || [],
    limits: DEFAULT_FULL_FETCH_LIMITS,
  };
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
  a.download = buildFileName(state.pageUrl, state.markdownVariant);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function buildFileName(pageUrl, variant) {
  const suffix = variant === 'full' ? '-full' : '';
  try {
    const host = new URL(pageUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `web-disassembly-pack-${host}${suffix}.md`;
  } catch {
    return `web-disassembly-pack${suffix}.md`;
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
  dangerExtraResult.innerHTML = '';
  dangerExtraResult.classList.remove('card-warning');
  dangerExtraResult.hidden = true;

  fullFetchStatusEl.textContent = '';
  markdownPreview.value = '';
  markdownVariantEl.textContent = '';
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
