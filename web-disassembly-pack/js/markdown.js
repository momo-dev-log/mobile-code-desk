/**
 * 解析結果からAI向けのMarkdown調査パックを組み立てる。
 *
 * 方針:
 * - HTML/CSS/JSの本文をそのまま大量に載せない
 * - CSS/JSはキーワード周辺の抜粋のみ（無い場合は概要のみ）
 * - 取得失敗・対象外のリソースもMarkdownに記録する
 * - 危険情報チェックの結果をセクションとして含める
 *
 * @param {object} data
 * @param {string} data.pageUrl
 * @param {string} data.finalUrl
 * @param {string} data.title
 * @param {object} data.structure
 * @param {Array} data.cssResources
 * @param {Array} data.jsResources
 * @param {Array} data.inlineStyles
 * @param {Array} data.inlineScripts
 * @param {Array} data.dangerFindings
 * @returns {string}
 */
export function buildMarkdown(data) {
  const {
    pageUrl,
    finalUrl,
    title,
    structure,
    cssResources,
    jsResources,
    inlineStyles,
    inlineScripts,
    dangerFindings,
  } = data;

  const lines = [];

  lines.push('# Web解体パック 調査結果');
  lines.push('');
  lines.push(`- 対象URL: ${pageUrl}`);
  if (finalUrl && finalUrl !== pageUrl) {
    lines.push(`- 最終URL（リダイレクト後）: ${finalUrl}`);
  }
  if (title) {
    lines.push(`- ページタイトル: ${title}`);
  }
  lines.push('');

  lines.push('## 構造の概要');
  lines.push('');
  lines.push(`- canvas: ${structure.canvas}件`);
  lines.push(`- button: ${structure.button}件`);
  lines.push(`- audio: ${structure.audio}件`);
  lines.push(`- video: ${structure.video}件`);
  lines.push(`- svg: ${structure.svg}件`);
  lines.push(`- script: インライン${structure.inlineScriptCount}件 / 外部参照${structure.externalScriptCount}件`);
  lines.push(`- stylesheet: インライン${structure.inlineStyleCount}件 / 外部参照${structure.externalStylesheetCount}件`);
  lines.push('');

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

  lines.push('## CSS');
  lines.push('');
  appendInlineSection(lines, inlineStyles, 'インラインstyle');
  appendResourceSection(lines, cssResources);

  lines.push('## JavaScript');
  lines.push('');
  appendInlineSection(lines, inlineScripts, 'インラインscript');
  appendResourceSection(lines, jsResources);

  return lines.join('\n');
}

function appendInlineSection(lines, entries, labelPrefix) {
  if (!entries || entries.length === 0) return;

  entries.forEach((entry, index) => {
    lines.push(`### ${labelPrefix} #${index + 1}（${entry.size}文字）`);
    lines.push('');
    appendExcerptsOrSummary(lines, entry);
  });
}

function appendResourceSection(lines, resources) {
  if (!resources || resources.length === 0) return;

  for (const entry of resources) {
    lines.push(`### ${entry.label}`);
    lines.push('');

    switch (entry.status) {
      case 'ok':
        lines.push(
          `- 状態: 取得成功（${entry.size}文字${entry.truncated ? '・先頭部分のみ処理' : ''}）`
        );
        lines.push('');
        appendExcerptsOrSummary(lines, entry);
        break;
      case 'failed':
        lines.push(`- 状態: 取得失敗（理由: ${entry.reason || 'unknown'}）`);
        lines.push('');
        break;
      case 'skipped_external':
        lines.push('- 状態: 取得対象外（外部オリジンのため v0.1ではスキップ）');
        lines.push('');
        break;
      case 'skipped_limit':
        lines.push('- 状態: 取得対象外（取得件数の上限を超えたためスキップ）');
        lines.push('');
        break;
      default:
        lines.push('- 状態: 不明');
        lines.push('');
    }
  }
}

function appendExcerptsOrSummary(lines, entry) {
  if (entry.excerpts && entry.excerpts.length > 0) {
    for (const ex of entry.excerpts) {
      lines.push(`キーワード: \`${ex.keyword}\``);
      lines.push('');
      lines.push('```');
      lines.push(ex.excerpt);
      lines.push('```');
      lines.push('');
    }
  } else if (entry.summary) {
    lines.push('```');
    lines.push(entry.summary);
    lines.push('```');
    lines.push('');
  } else {
    lines.push('（該当キーワードなし）');
    lines.push('');
  }
}
