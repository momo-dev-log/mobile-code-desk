import { JS_FEATURE_SUMMARY_MAP } from './keywords.js';
import { APP_VERSION } from './constants.js';

/**
 * 解析結果からAI向けのMarkdown調査パックを組み立てる（v0.2）。
 *
 * 方針:
 * - 見出し順は固定（メタ情報→サマリ行→HTML構造→検出ライブラリ→
 *   JS内キーワード検出→CSS抜粋→JavaScript抜粋→推定メモ→
 *   危険情報チェック結果→取得対象外の記録）
 * - 検出が無い項目も省略せず、値（あり/なし/特定できず/未確認）として出す
 * - CSS/JSはカテゴリごとの抜粋のみ（全文ダンプ化しない）
 * - 推定メモは「あり」の項目のみを根拠にする
 *
 * @param {object} data
 * @param {string} data.pageUrl
 * @param {string} data.finalUrl
 * @param {string} data.title
 * @param {object} data.structure
 * @param {Array<{ key: string, label: string, value: string }>} data.jsFeatures JS内キーワード検出（12項目）
 * @param {Array<{ key: string, label: string, value: string }>} data.libraries 外部ライブラリ検出（10項目）
 * @param {Array<{ key: string, label: string, excerpts: Array }>} data.cssExcerpts
 * @param {Array<{ key: string, label: string, excerpts: Array }>} data.jsExcerpts
 * @param {Array} data.cssResources
 * @param {Array} data.jsResources
 * @param {Array} data.dangerFindings
 * @returns {string}
 */
export function buildMarkdown(data) {
  const {
    pageUrl,
    finalUrl,
    title,
    structure,
    jsFeatures,
    libraries,
    cssExcerpts,
    jsExcerpts,
    cssResources,
    jsResources,
    dangerFindings,
  } = data;

  const lines = [];

  // 1. メタ情報
  lines.push('# Web解体パック 調査結果');
  lines.push('');
  lines.push(`- 対象URL: ${pageUrl}`);
  if (finalUrl && finalUrl !== pageUrl) {
    lines.push(`- 最終URL（リダイレクト後）: ${finalUrl}`);
  }
  if (title) {
    lines.push(`- ページタイトル: ${title}`);
  }
  lines.push(`- Web解体パック版: ${APP_VERSION}`);
  lines.push('');

  // 2. サマリ行
  lines.push(buildSummaryLine({ structure, jsFeatures, libraries, dangerFindings }));
  lines.push('');

  // 3. HTML構造
  buildHtmlStructureSection(lines, structure);

  // 4. 検出ライブラリ
  buildDetectionSection(lines, '## 検出ライブラリ', libraries);

  // 5. JS内キーワード検出
  buildDetectionSection(lines, '## JS内キーワード検出', jsFeatures);

  // 6. CSS抜粋
  buildExcerptSection(lines, '## CSS抜粋', cssExcerpts);

  // 7. JavaScript抜粋
  buildExcerptSection(lines, '## JavaScript抜粋', jsExcerpts);

  // 8. 推定メモ
  lines.push('## 推定メモ');
  lines.push('');
  for (const note of buildEstimationNotes(structure, jsFeatures, libraries)) {
    lines.push(`- ${note}`);
  }
  lines.push('');

  // 9. 危険情報チェック結果
  lines.push('## 危険情報チェック結果');
  lines.push('');
  if (dangerFindings && dangerFindings.length > 0) {
    lines.push('以下のパターンが検出されました。共有してよいか確認してください。');
    lines.push('');
    for (const finding of dangerFindings) {
      lines.push(`- [${finding.label}] ${finding.type}: \`${finding.preview}\``);
    }
  } else {
    lines.push('チェック対象のパターンは検出されませんでした。');
  }
  lines.push('');

  // 10. 取得対象外の記録
  buildSkippedSection(lines, cssResources, jsResources);

  return lines.join('\n');
}

/**
 * サマリ行（Markdown内のキーは語順・キー名固定）。
 * 本文4値（あり/なし/特定できず/未確認）→サマリ3値（yes/no/unknown）に変換する。
 */
function buildSummaryLine({ structure, jsFeatures, libraries, dangerFindings }) {
  const parts = [];

  parts.push(`canvas_tag:${formatCount(structure.canvas)}`);
  parts.push(`button:${formatCount(structure.button)}`);
  parts.push(`audio:${formatCount(structure.audio)}`);
  parts.push(`video:${formatCount(structure.video)}`);
  parts.push(`svg:${formatCount(structure.svg)}`);
  parts.push(`inline_script:${formatCount(structure.inlineScriptCount)}`);
  parts.push(`external_script:${formatCount(structure.externalScriptCount)}`);
  parts.push(`inline_style:${formatCount(structure.inlineStyleCount)}`);
  parts.push(`external_style:${formatCount(structure.externalStylesheetCount)}`);

  for (const [summaryKey, featureKey] of JS_FEATURE_SUMMARY_MAP) {
    const feature = (jsFeatures || []).find((f) => f.key === featureKey);
    parts.push(`${summaryKey}:${toSummaryValue(feature && feature.value)}`);
  }

  for (const lib of libraries || []) {
    parts.push(`lib_${lib.key}:${toSummaryValue(lib.value)}`);
  }

  parts.push(`danger:${dangerFindings && dangerFindings.length > 0 ? 'yes' : 'no'}`);

  return `summary: ${parts.join(' | ')}`;
}

function formatCount(value) {
  if (value === undefined || value === null || value === 'unknown') return 'unknown';
  return String(value);
}

function toSummaryValue(value) {
  switch (value) {
    case 'あり':
      return 'yes';
    case 'なし':
      return 'no';
    case '特定できず':
    case '未確認':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function buildHtmlStructureSection(lines, structure) {
  lines.push('## HTML構造');
  lines.push('');
  lines.push(`- canvasタグ: ${formatCount(structure.canvas)}件`);
  lines.push(`- button: ${formatCount(structure.button)}件`);
  lines.push(`- audio: ${formatCount(structure.audio)}件`);
  lines.push(`- video: ${formatCount(structure.video)}件`);
  lines.push(`- svg: ${formatCount(structure.svg)}件`);
  lines.push(`- script（インライン）: ${formatCount(structure.inlineScriptCount)}件`);
  lines.push(`- script（外部参照）: ${formatCount(structure.externalScriptCount)}件`);
  lines.push(`- stylesheet（インライン）: ${formatCount(structure.inlineStyleCount)}件`);
  lines.push(`- stylesheet（外部参照）: ${formatCount(structure.externalStylesheetCount)}件`);
  lines.push('');
}

/**
 * 「検出ライブラリ」「JS内キーワード検出」のような、
 * 固定項目を `- ラベル: 値` で列挙するセクションを出力する。
 */
function buildDetectionSection(lines, heading, items) {
  lines.push(heading);
  lines.push('');
  for (const item of items || []) {
    lines.push(`- ${item.label}: ${item.value}`);
  }
  lines.push('');
}

/**
 * 「CSS抜粋」「JavaScript抜粋」のような、観点ごとの抜粋セクションを出力する。
 * 該当が無い観点も省略せず「（該当なし）」を出す。
 */
function buildExcerptSection(lines, heading, categories) {
  lines.push(heading);
  lines.push('');

  for (const category of categories || []) {
    lines.push(`### ${category.label}`);
    lines.push('');

    if (!category.excerpts || category.excerpts.length === 0) {
      lines.push('（該当なし）');
      lines.push('');
      continue;
    }

    for (const ex of category.excerpts) {
      lines.push(`キーワード: \`${ex.keyword}\`（${ex.source}）`);
      lines.push('');
      lines.push('```');
      lines.push(ex.excerpt);
      lines.push('```');
      lines.push('');
    }
  }
}

/**
 * HTML構造・JS内キーワード検出・外部ライブラリ検出の結果から、
 * 初心者にも分かる推定メモを作る。
 *
 * 「あり」の項目のみを根拠にする。「なし」「特定できず」「未確認」を
 * 根拠にした断定は行わない。
 */
function buildEstimationNotes(structure, jsFeatures, libraries) {
  const notes = [];
  const jsFound = (key) => (jsFeatures || []).find((f) => f.key === key)?.value === 'あり';
  const libFound = (key) => (libraries || []).find((l) => l.key === key)?.value === 'あり';

  notes.push('HTMLにcanvasタグがなくても、JavaScriptでCanvas/WebGLが生成される場合があります。');

  const canvasKeywords = [];
  if (jsFound('canvas')) canvasKeywords.push('"canvas"');
  if (jsFound('getContext')) canvasKeywords.push('"getContext"');
  if (jsFound('rendererDomElement')) canvasKeywords.push('"renderer.domElement"');

  if (canvasKeywords.length > 0) {
    notes.push(`このページではJS内に ${canvasKeywords.join(' や ')} があるため、実行時にCanvas/WebGL描画を使っている可能性があります。`);
  }

  if (libFound('three')) {
    notes.push('Three.jsを読み込んでいる場合、WebGL描画の可能性があります。');
  }

  if (jsFound('webgl')) {
    notes.push('JS内に "WebGL" があるため、WebGLコンテキストを使った描画を行っている可能性があります。');
  }

  const pointerLabels = [];
  if (jsFound('pointerEvents')) pointerLabels.push('pointer操作');
  if (jsFound('touch')) pointerLabels.push('touch操作');
  if (jsFound('mouse')) pointerLabels.push('mouse操作');

  if (pointerLabels.length > 0) {
    notes.push(`JS内に${pointerLabels.join('・')}の処理があるため、画面上での描画・操作（お絵描き等）に対応している可能性があります。`);
  }

  if (jsFound('raf')) {
    notes.push('JS内に "requestAnimationFrame" があるため、アニメーションや継続的な描画ループを行っている可能性があります。');
  }

  if (structure.canvas === 0 && (jsFound('canvas') || jsFound('webgl') || libFound('three'))) {
    notes.push('HTML側のcanvasタグは0件ですが、JS側の検出結果から、ページ表示後にcanvasが動的に生成される可能性があります。');
  }

  return notes;
}

/**
 * 取得対象外・取得失敗のCSS/JSリソースを一覧化する。
 */
function buildSkippedSection(lines, cssResources, jsResources) {
  lines.push('## 取得対象外の記録');
  lines.push('');

  const entries = [];
  for (const entry of cssResources || []) {
    if (entry.status === 'ok') continue;
    entries.push({ type: 'CSS', ...entry });
  }
  for (const entry of jsResources || []) {
    if (entry.status === 'ok') continue;
    entries.push({ type: 'JS', ...entry });
  }

  if (entries.length === 0) {
    lines.push('（取得対象外・取得失敗のリソースはありません）');
    lines.push('');
    return;
  }

  for (const entry of entries) {
    lines.push(`- [${entry.type}] ${entry.label}: ${describeSkipped(entry)}`);
  }
  lines.push('');
}

function describeSkipped(entry) {
  switch (entry.status) {
    case 'failed':
      return `取得失敗（理由: ${entry.reason || 'unknown'}）`;
    case 'skipped_external':
      return '取得対象外（外部オリジンのため対象外）';
    case 'skipped_limit':
      return '取得対象外（取得件数の上限を超過）';
    default:
      return '不明';
  }
}
