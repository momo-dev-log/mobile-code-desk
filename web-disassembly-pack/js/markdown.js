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
 * @param {Array} data.jsFeatures
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
    jsFeatures,
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

  lines.push('## HTML構造（タグの有無・件数）');
  lines.push('');
  lines.push(`- canvasタグ: ${structure.canvas}件`);
  lines.push(`- button: ${structure.button}件`);
  lines.push(`- audio: ${structure.audio}件`);
  lines.push(`- video: ${structure.video}件`);
  lines.push(`- svg: ${structure.svg}件`);
  lines.push(`- script: インライン${structure.inlineScriptCount}件 / 外部参照${structure.externalScriptCount}件`);
  lines.push(`- stylesheet: インライン${structure.inlineStyleCount}件 / 外部参照${structure.externalStylesheetCount}件`);
  lines.push('');

  lines.push('## JS内キーワード検出');
  lines.push('');
  lines.push('HTMLにcanvasタグ等が無くても、JavaScript内でこれらが使われていれば、');
  lines.push('実行時にCanvas/WebGL描画などが行われている可能性があります。');
  lines.push('');
  if (jsFeatures && jsFeatures.length > 0) {
    for (const feature of jsFeatures) {
      lines.push(`- ${feature.label}: ${feature.found ? 'あり' : 'なし'}`);
    }
  } else {
    lines.push('（検出対象のJSがありませんでした）');
  }
  lines.push('');

  const estimationNotes = buildEstimationNotes(structure, jsFeatures);
  if (estimationNotes.length > 0) {
    lines.push('## 推定メモ');
    lines.push('');
    for (const note of estimationNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

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

/**
 * HTML構造とJS内キーワード検出の結果から、初心者にも分かる推定メモを作る。
 * あくまで「可能性がある」という推定であり、断定はしない。
 */
function buildEstimationNotes(structure, jsFeatures) {
  const notes = [];
  const found = (key) => (jsFeatures || []).some((f) => f.key === key && f.found);

  notes.push('HTMLにcanvasタグがなくても、JavaScriptでCanvas/WebGLが生成される場合があります。');

  if (found('canvas') || found('getContext')) {
    notes.push('このページではJS内に "canvas" や "getContext" があるため、実行時にCanvas描画を使っている可能性があります。');
  }

  if (found('rendererDomElement')) {
    notes.push('JS内に "renderer.domElement" があるため、3D描画ライブラリがcanvas要素を生成して画面に追加している可能性があります。');
  }

  if (found('three')) {
    notes.push('Three.jsを読み込んでいる場合、WebGL描画の可能性があります。');
  }

  if (found('webgl')) {
    notes.push('JS内に "WebGL" があるため、WebGLコンテキストを使った描画を行っている可能性があります。');
  }

  if (found('pointerOps')) {
    notes.push('JS内にpointer/touch/mouse操作の処理があるため、画面上での描画・操作（お絵描き等）に対応している可能性があります。');
  }

  if (found('requestAnimationFrame')) {
    notes.push('JS内に "requestAnimationFrame" があるため、アニメーションや継続的な描画ループを行っている可能性があります。');
  }

  if (structure.canvas === 0 && (found('canvas') || found('webgl') || found('three'))) {
    notes.push('HTML側のcanvasタグは0件ですが、JS側の検出結果から、ページ表示後にcanvasが動的に生成される可能性があります。');
  }

  return notes;
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
