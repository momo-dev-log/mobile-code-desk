import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHtmlSkeleton,
  planCodeInclusion,
  buildFullTextSections,
  fenceCode,
  inlineCode,
  sanitizeCodeText,
  tokenizeHtml,
  computeOpenStacks,
  MASK_MARKER,
} from '../js/fulltext.js';
import { buildMarkdown, buildFullMarkdown, FULL_VARIANT_META_LINE } from '../js/markdown.js';
import { checkDangerousContent, maskSensitive } from '../js/danger-check.js';
import { truncateForAnalysis, buildInlineEntry } from '../js/coverage.js';
import { JS_FEATURE_CHECKS, CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from '../js/keywords.js';
import { LIBRARY_CHECKS } from '../js/libraries.js';
import {
  MAX_FULL_HTML_CHARS,
  MAX_FULL_CODE_CHARS,
  MIN_PARTIAL_CHARS,
  MAX_RESOURCE_CHARS,
  MAX_CSS_FILES,
  MAX_JS_FILES,
} from '../js/constants.js';

// -----------------------------------------------
// 補助
// -----------------------------------------------
const inline = (label, text) => buildInlineEntry(text, label);
const external = (url, text) => ({ label: url, status: 'ok', ...truncateForAnalysis(text) });
const sized = (n, ch = 'a') => ch.repeat(n);

function codeInput(overrides = {}) {
  return { inlineStyles: [], inlineScripts: [], cssResources: [], jsResources: [], ...overrides };
}

/** Markdownから、コードフェンスの外側にある行だけを取り出す（CommonMarkの閉じ方に合わせる） */
function linesOutsideFences(markdown) {
  const outside = [];
  let fence = null;
  for (const line of markdown.split('\n')) {
    if (fence) {
      if (new RegExp(`^${fence}\`*\\s*$`).test(line)) fence = null;
      continue;
    }
    const open = line.match(/^(`{3,})/);
    if (open) {
      fence = open[1];
      continue;
    }
    outside.push(line);
  }
  assert.equal(fence, null, 'コードフェンスが閉じていません');
  return outside;
}

/** インラインコード（バッククォートで囲まれた部分）を取り除く */
function stripInlineCode(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, '');
}

function baseData(overrides = {}) {
  return {
    pageUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    title: 'Example',
    structure: {
      canvas: 0, button: 0, audio: 0, video: 0, svg: 0,
      inlineScriptCount: 1, externalScriptCount: 1, inlineStyleCount: 1, externalStylesheetCount: 0,
    },
    jsFeatures: JS_FEATURE_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    libraries: LIBRARY_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    cssExcerpts: CSS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    jsExcerpts: JS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    cssResources: [],
    jsResources: [external('https://example.com/app.js', 'function draw() {}')],
    dangerFindings: [],
    htmlChars: 100,
    inlineStyles: [inline('インラインstyle #1', 'body { margin: 0 }')],
    inlineScripts: [inline('インラインscript #1', 'draw();')],
    html: '<html><head><style>body { margin: 0 }</style></head><body><script>draw();</script><script src="/app.js"></script></body></html>',
    ...overrides,
  };
}

// -----------------------------------------------
// 既存の上限を変えていない
// -----------------------------------------------
test('既存の取得上限（CSS 5件・JS 5件・1ファイル200KiB）は変わっていない', () => {
  assert.equal(MAX_CSS_FILES, 5);
  assert.equal(MAX_JS_FILES, 5);
  assert.equal(MAX_RESOURCE_CHARS, 200 * 1024);
  assert.equal(MAX_FULL_HTML_CHARS, 20000);
  assert.equal(MAX_FULL_CODE_CHARS, 100000);
});

// -----------------------------------------------
// HTML構造枠
// -----------------------------------------------
test('HTML構造枠: script/styleの本文を取り除き、識別子つきの置き換え文にする', () => {
  const html = '<head><style>.a{color:red}</style><script src="/x.js"></script></head>'
    + '<body><script>  </script><script>SECRET_BODY_1()</script><svg><style>.b{}</style></svg>'
    + '<template><script>TEMPLATE_BODY()</script></template><script>SECRET_BODY_2()</script></body>';
  const result = buildHtmlSkeleton(html);

  assert.ok(!result.text.includes('SECRET_BODY_1'));
  assert.ok(!result.text.includes('SECRET_BODY_2'));
  assert.ok(!result.text.includes('TEMPLATE_BODY'));
  assert.ok(!result.text.includes('.a{color:red}'));
  // 番号は parse.js と同じく、空でないインラインのものだけを数える（template内は数えない）
  assert.match(result.text, /インラインscript #1（15文字）/);
  assert.match(result.text, /インラインscript #2（15文字）/);
  assert.ok(!result.text.includes('インラインscript #3'));
  assert.match(result.text, /インラインstyle #1（13文字）/);
  assert.match(result.text, /インラインstyle #2（4文字）/);
  assert.match(result.text, /template内のscript本文/);
  // タグ構造は残る
  assert.ok(result.text.includes('<script src="/x.js"></script>'));
  assert.ok(result.text.includes('<svg><style>'));
  assert.equal(result.removedScriptBodies, 3);
  assert.equal(result.removedStyleBodies, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.compacted, false);
});

test('HTML構造枠: 上限内ならscript/style以外は元のまま（空白・テキストも変えない）', () => {
  const html = '<!DOCTYPE html>\n<html>\n  <body>\n    <p class="x"   id=\'y\'>Hello   world</p>\n  </body>\n</html>';
  const result = buildHtmlSkeleton(html);
  assert.equal(result.text, html);
  assert.equal(result.originalChars, html.length);
  assert.equal(result.includedChars, html.length);
});

test('HTML構造枠: 引用符の中の「>」や「</script>」の扱いがブラウザと同じ', () => {
  const html = '<div title="a > b" data-x=\'<c>\'>T</div><script>var s = "<div>"; </script><p>after</p>';
  const tokens = tokenizeHtml(html);
  assert.equal(tokens[0].raw, '<div title="a > b" data-x=\'<c>\'>');
  const result = buildHtmlSkeleton(html);
  assert.ok(result.text.startsWith('<div title="a > b" data-x=\'<c>\'>T</div><script>/* [WDP]'));
  assert.ok(result.text.endsWith('</script><p>after</p>'));
});

test('HTML構造枠: 上限を超えると長い部分を短くし、それでも超えると先頭と末尾を残して省略を明記する', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => `<div class="row r${i}" style="${'x'.repeat(300)}"><span>${'text '.repeat(80)}</span></div>`);
  const html = `<!DOCTYPE html><html><head><title>T</title></head><body><header id="top"></header>${rows.join('\n')}<footer id="end"></footer><script src="/last.js"></script></body></html>`;
  const result = buildHtmlSkeleton(html);

  assert.ok(result.includedChars <= MAX_FULL_HTML_CHARS, `${result.includedChars} > ${MAX_FULL_HTML_CHARS}`);
  assert.equal(result.text.length, result.includedChars);
  assert.equal(result.originalChars, html.length);
  assert.equal(result.compacted, true);
  assert.equal(result.truncated, true);
  assert.ok(result.omittedChars > 0);
  assert.ok(result.shortened.text > 0);
  assert.ok(result.shortened.attribute > 0);
  // 先頭（head）と末尾（閉じタグ・最後のscript）が残る
  assert.ok(result.text.startsWith('<!DOCTYPE html><html><head><title>T</title></head><body><header id="top"></header>'));
  assert.ok(result.text.endsWith('<footer id="end"></footer><script src="/last.js"></script></body></html>'));
  assert.match(result.text, /<!-- \[WDP\] ここから \d+文字（開始タグ \d+個を含む）を文字数上限のため省略。[^\n]*欠けたタグは補っていません -->/);
  // タグの途中で切っていない（省略の目印の直前・直後がタグの境目）
  const [head, tail] = result.text.split(/\n<!-- \[WDP\] ここから[^\n]*-->\n/);
  assert.ok(head.trimEnd().endsWith('>'), head.slice(-50));
  assert.ok(tail.trimStart().startsWith('<'), tail.slice(0, 50));
});

test('HTML構造枠: 短縮だけで上限内に収まる場合は、中間を省略しない', () => {
  const html = `<body>${'<p>' + 'word '.repeat(5000) + '</p>'}<img src="data:image/png;base64,${'A'.repeat(30000)}"></body>`;
  const result = buildHtmlSkeleton(html);
  assert.equal(result.compacted, true);
  assert.equal(result.truncated, false);
  assert.ok(result.text.startsWith('<body><p>word word'));
  assert.match(result.text, /<img src="data:image\/png;base64,A+…\[WDP:\d+文字省略\]">/);
  assert.ok(result.text.endsWith('</p><img src="data:image/png;base64,' + 'A'.repeat(100 - 'data:image/png;base64,'.length) + `…[WDP:${30022 - 100}文字省略]"></body>`));
});

test('HTML構造枠: トークン・パスワードらしい属性値と、危険情報パターンをマスクする', () => {
  const html = '<meta name="csrf-token" content="Zx9csrfvalue">'
    + '<input type="hidden" name="authenticity_token" value="hiddenTokenValue">'
    + '<input type="password" value="hunter2">'
    + '<div data-api-key="k-12345">mail: someone@example.com</div>'
    + '<script nonce="r4nd0m">x()</script><meta name="author" content="Taro">';
  const result = buildHtmlSkeleton(html);
  for (const secret of ['Zx9csrfvalue', 'hiddenTokenValue', 'hunter2', 'k-12345', 'someone@example.com', 'r4nd0m']) {
    assert.ok(!result.text.includes(secret), `${secret} が残っています`);
  }
  assert.ok(result.text.includes('content="Taro"'), 'トークンと無関係な属性までマスクしています');
  assert.ok(result.maskedCount >= 6);
});

// -----------------------------------------------
// CSS/JS本文の収録計画
// -----------------------------------------------
test('CSS/JS本文: 合計が上限以内で、小さいソースから優先し、入りきらない最初の1件だけ途中まで収録する', () => {
  const plan = planCodeInclusion(codeInput({
    inlineScripts: [inline('インラインscript #1', sized(90000, 'b'))],
    jsResources: [
      external('https://e.example/big.js', sized(150000, 'c')),
      external('https://e.example/small.js', sized(20000, 'd')),
      external('https://e.example/tiny.js', sized(300, 'e')),
    ],
  }));
  const [inl, big, small, tiny] = plan.js;

  assert.ok(plan.usedChars <= MAX_FULL_CODE_CHARS);
  assert.equal(plan.jsBudget, MAX_FULL_CODE_CHARS); // CSSが無いので、JSが全枠を使える
  assert.deepEqual([tiny.priority, small.priority, inl.priority, big.priority], [1, 2, 3, 4]);
  assert.equal(tiny.inclusion, 'full');
  assert.equal(small.inclusion, 'full');
  assert.equal(inl.inclusion, 'partial');
  assert.equal(inl.includedChars, MAX_FULL_CODE_CHARS - 20300);
  assert.equal(big.inclusion, 'none');
  assert.equal(plan.usedChars, MAX_FULL_CODE_CHARS);
});

test('CSS/JS本文: 残り枠が小さすぎる場合は途中収録せず、後続も収録しない', () => {
  const plan = planCodeInclusion(codeInput({
    jsResources: [
      external('https://e.example/a.js', sized(MAX_FULL_CODE_CHARS - 100, 'a')),
      external('https://e.example/b.js', sized(5000, 'b')),
    ],
  }));
  // 小さい順: b(5000) → a(99,900)。a は残り95,000で途中収録
  assert.equal(plan.js[1].inclusion, 'full');
  assert.equal(plan.js[0].inclusion, 'partial');

  const plan2 = planCodeInclusion(codeInput({
    jsResources: [
      external('https://e.example/a.js', sized(99000, 'a')),
      external('https://e.example/b.js', sized(1000, 'b')),
      external('https://e.example/c.js', sized(MAX_FULL_CODE_CHARS - 1000 - (MIN_PARTIAL_CHARS - 1), 'c')),
    ],
  }));
  // 小さい順: b → c → a。b・c を全文収録した後、残りは MIN_PARTIAL_CHARS - 1 文字 → a は収録しない
  assert.equal(plan2.js[1].inclusion, 'full');
  assert.equal(plan2.js[2].inclusion, 'full');
  assert.equal(plan2.js[0].inclusion, 'none');
  assert.equal(plan2.js[0].includedChars, 0);
  assert.equal(plan2.usedChars, MAX_FULL_CODE_CHARS - (MIN_PARTIAL_CHARS - 1));
});

test('CSS/JS本文: CSSとJSの配分（40%/60%、使わない分はもう片方へ）', () => {
  const bothBig = planCodeInclusion(codeInput({
    cssResources: [external('https://e.example/a.css', sized(150000))],
    jsResources: [external('https://e.example/a.js', sized(150000))],
  }));
  assert.equal(bothBig.cssBudget, 40000);
  assert.equal(bothBig.jsBudget, 60000);
  assert.equal(bothBig.css[0].includedChars, 40000);
  assert.equal(bothBig.js[0].includedChars, 60000);

  const smallCss = planCodeInclusion(codeInput({
    inlineStyles: [inline('インラインstyle #1', sized(1000))],
    jsResources: [external('https://e.example/a.js', sized(150000))],
  }));
  assert.equal(smallCss.cssBudget, 1000);
  assert.equal(smallCss.jsBudget, 99000);

  const smallJs = planCodeInclusion(codeInput({
    cssResources: [external('https://e.example/a.css', sized(150000))],
    inlineScripts: [inline('インラインscript #1', sized(5000))],
  }));
  assert.equal(smallJs.cssBudget, 95000);
  assert.equal(smallJs.jsBudget, 5000);
  assert.ok(smallJs.usedChars <= MAX_FULL_CODE_CHARS);
});

test('CSS/JS本文: 同じ本文は1回だけ収録し、枠を使わない', () => {
  const plan = planCodeInclusion(codeInput({
    inlineScripts: [inline('インラインscript #1', 'same();'), inline('インラインscript #2', 'same();')],
    jsResources: [external('https://e.example/a.js', 'same();'), external('https://e.example/b.js', 'other();')],
  }));
  assert.equal(plan.js[0].inclusion, 'full');
  assert.equal(plan.js[1].inclusion, 'duplicate');
  assert.equal(plan.js[1].duplicateOf, 'インラインscript #1');
  assert.equal(plan.js[2].inclusion, 'duplicate');
  assert.equal(plan.js[3].inclusion, 'full');
  assert.equal(plan.usedChars, 'same();'.length + 'other();'.length);
});

test('CSS/JS本文: minify済みらしいJSも除外しない', () => {
  const minified = 'var a=1;'.repeat(2000); // 改行なし16,000文字（looksMinified の対象）
  const plan = planCodeInclusion(codeInput({ jsResources: [external('https://e.example/m.min.js', minified)] }));
  assert.equal(plan.js[0].inclusion, 'full');
  assert.equal(plan.js[0].includedChars, minified.length);
});

test('CSS/JS本文: 取得失敗・外部オリジン・件数上限のものは本文に入れず、理由を記録する', () => {
  const md = buildFullTextSections(baseData({
    cssResources: [
      { label: 'https://cdn.other/x.css', status: 'skipped_external' },
      { label: 'https://example.com/f.css', status: 'failed', reason: 'HTTPエラー 404' },
    ],
    jsResources: [
      external('https://example.com/app.js', 'ok();'),
      { label: 'https://example.com/6.js', status: 'skipped_limit' },
    ],
  }));
  assert.match(md, /- \[CSS\] `https:\/\/cdn.other\/x.css`: 外部オリジンのため取得対象外/);
  assert.match(md, /- \[CSS\] `https:\/\/example.com\/f.css`: 取得失敗（理由: HTTPエラー 404）/);
  assert.match(md, /- \[JS\] `https:\/\/example.com\/6.js`: 取得件数の上限を超えたため取得対象外/);
  assert.ok(!md.includes('#### [CSS・外部（同一オリジン）] `https://cdn.other/x.css`'));
});

test('全文節: 途中まで・解析上限で切り詰めたソースは、文字数とともに明示する', () => {
  const huge = sized(MAX_RESOURCE_CHARS + 5000, 'z');
  const md = buildFullTextSections(baseData({
    inlineScripts: [],
    jsResources: [external('https://example.com/huge.js', huge)],
  }));
  assert.match(md, new RegExp(`- 元の文字数: ${huge.length}文字`));
  assert.match(md, new RegExp(`- 解析範囲: ${MAX_RESOURCE_CHARS}文字（1ファイルの解析上限で切り詰め`));
  assert.match(md, /- 収録: \d+文字（途中まで。文字数上限のため \d+文字目以降は未収録）/);
  assert.match(md, /\*\*↑ このソースはここで途中終了しています（残り \d+文字は未収録）。\*\*/);
  assert.match(md, new RegExp(`1ファイルの解析上限のため ${MAX_RESOURCE_CHARS + 1}文字目以降は取得・収録せず`));
});

test('全文節: 本文の合計が上限を超える入力でも、フェンス内の本文は上限以内', () => {
  const md = buildFullTextSections(baseData({
    inlineStyles: [inline('インラインstyle #1', sized(80000, 's'))],
    cssResources: [external('https://example.com/a.css', sized(80000, 't'))],
    inlineScripts: [inline('インラインscript #1', sized(90000, 'u'))],
    jsResources: [external('https://example.com/a.js', sized(90000, 'v'))],
  }));
  const bodyChars = [...md.matchAll(/^```(?:css|javascript)\n([\s\S]*?)\n```$/gm)].reduce((sum, m) => sum + m[1].length, 0);
  assert.ok(bodyChars <= MAX_FULL_CODE_CHARS, `${bodyChars}`);
  assert.equal(bodyChars, MAX_FULL_CODE_CHARS);
});

// -----------------------------------------------
// コードフェンス・危険な文字列
// -----------------------------------------------
test('コードフェンス: 本文中のバッククォートより長いフェンスを使い、本文で閉じない', () => {
  const body = 'a\n```\nb\n````js\nc ````` d';
  const fenced = fenceCode(body, 'js');
  assert.ok(fenced.startsWith('``````js\n'));
  assert.ok(fenced.endsWith('\n``````'));
  assert.deepEqual(linesOutsideFences(`x\n${fenced}\ny`), ['x', 'y']);
  assert.ok(fenceCode('plain').startsWith('```\n'));
});

test('コードフェンス: 本文に「```」や「</script>」があっても、フェンスの外へ漏れない', () => {
  const evilJs = 'const s = "```";\n```\n</script><script>alert(1)</script>\n# 見出し偽装\n<img src=x onerror=alert(1)>';
  const evilCss = '/* ```` */ body{} </style><script>alert(2)</script>';
  const md = buildFullMarkdown(baseData({
    inlineStyles: [inline('インラインstyle #1', evilCss)],
    inlineScripts: [inline('インラインscript #1', evilJs)],
    jsResources: [external('https://example.com/a`b`c.js', 'x();')],
    html: `<body><div onclick="alert(3)">\`\`\`</div><script>${evilJs}</script><style>${evilCss}</style></body>`,
  }));

  const outside = linesOutsideFences(md);
  for (const line of outside) {
    const plain = stripInlineCode(line);
    assert.ok(!/<script|<\/script|<img|<style|onerror|onclick|alert\(/i.test(plain), `フェンスの外に出ています: ${line}`);
  }
  assert.ok(!outside.includes('# 見出し偽装'));

  // 識別子に改行が入っていても、全文つき版のどの節の見出しも壊れない
  const withNewline = buildFullMarkdown(baseData({ jsResources: [external('https://example.com/x.js\n## 偽見出し', 'x();')] }));
  assert.ok(!linesOutsideFences(withNewline).some((line) => line.startsWith('## 偽見出し')));
  // 本文そのものはフェンスの中に残っている（実行はしない）
  assert.ok(md.includes('</script><script>alert(1)</script>'));
});

test('インラインコード: 識別子のバッククォート・改行で書式が壊れない', () => {
  assert.equal(inlineCode('a`b'), '``a`b``');
  assert.equal(inlineCode('`x`'), '`` `x` ``');
  assert.equal(inlineCode('a\nb'), '`a b`');
});

test('見えない制御文字（文字の向きを変える文字・NUL）を見える表記にする', () => {
  const { text, replacedControls } = sanitizeCodeText('a‮b\u0000c⁦d\r\ne\rf');
  assert.equal(text, 'a[U+202E]b[U+0000]c[U+2066]d\ne\nf');
  assert.equal(replacedControls, 3);

  const md = buildFullTextSections(baseData({ inlineScripts: [inline('インラインscript #1', 'if (x‮) {}')] }));
  assert.ok(!md.includes('‮'));
  assert.match(md, /制御文字の置き換え: 1件/);
});

test('機密情報: 危険情報パターンをマスクして収録し、マスクできることは完全でないと明記する', () => {
  const js = 'const apiKey = "abcdefghijklmnop1234";\nfetch(u, { headers: { Authorization: "Bearer eyJhbGciOi.abc.def" } });\n'
    + 'const key = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----`;\nconst id = "AKIAABCDEFGHIJKLMNOP"; // dev@example.com';
  const md = buildFullTextSections(baseData({ inlineScripts: [inline('インラインscript #1', js)] }));
  for (const secret of ['abcdefghijklmnop1234', 'eyJhbGciOi', 'MIIEowIBAAKCAQEA', 'AKIAABCDEFGHIJKLMNOP', 'dev@example.com']) {
    assert.ok(!md.includes(secret), `${secret} が残っています`);
  }
  assert.ok(md.includes(`const apiKey = "${MASK_MARKER}"`), 'キー名は残して値だけをマスクする');
  assert.match(md, /- マスク: 5件/);
  assert.match(md, /すべての機密情報・個人情報を見つけられるわけではありません/);
});

test('機密情報: マスク用の正規表現変更後も、危険情報チェックの検出結果は変わらない', () => {
  const findings = checkDangerousContent([{ label: 'X', text: 'api_key: "abcdefghijklmnop" -----BEGIN PRIVATE KEY-----\nAAA' }]);
  assert.deepEqual(findings.map((f) => f.type), ['APIキー/トークンらしき文字列', '秘密鍵ブロック']);
  assert.equal(findings[0].preview, 'api_...mnop');
  assert.equal(maskSensitive('no secrets here').count, 0);
});

// -----------------------------------------------
// 通常版との独立性
// -----------------------------------------------
test('通常版: html を渡しても出力は変わらず、全文収録の節を含まない', () => {
  const data = baseData();
  const { html, ...withoutHtml } = data;
  const normal = buildMarkdown(withoutHtml);
  assert.equal(buildMarkdown(data), normal);
  assert.ok(!normal.includes('全文収録'));
  assert.ok(!normal.includes(FULL_VARIANT_META_LINE));
  assert.ok(!normal.includes('function draw() {}'), '通常版に外部JSの全文が入っています');
  assert.ok(html.length > 0);
});

test('全文つき版: 通常版と同じ見出し構成・summary行に、メタ情報1行と末尾の全文節を加えたもの', () => {
  const data = baseData();
  const normal = buildMarkdown(data);
  const full = buildFullMarkdown(data);
  const headings = (md) => md.split('\n').filter((line) => /^#{1,3} /.test(line));
  const summaryLine = (md) => md.split('\n').find((line) => line.startsWith('summary: '));

  assert.ok(full.includes(FULL_VARIANT_META_LINE));
  const fullHeadings = headings(full);
  const appendedAt = fullHeadings.indexOf('## 全文収録（全文つき版のみ）');
  assert.deepEqual(fullHeadings.slice(0, appendedAt), headings(normal));
  assert.equal(summaryLine(full), summaryLine(normal));
  assert.ok(full.includes('function draw() {}'));
  // 入力（state）を書き換えない
  assert.equal(data.inlineScripts[0].rawText, 'draw();');
  assert.equal(buildMarkdown(data), normal);
});

test('全文つき版: 同じ入力なら何度作っても同じ出力になる', () => {
  const data = baseData();
  assert.equal(buildFullMarkdown(data), buildFullMarkdown(data));
});

// -----------------------------------------------
// PR #100 レビュー対応: 省略によるタグ対応の崩れ
// -----------------------------------------------
function sectionsHtml(count) {
  const one = (i) => `<section id="s${i}"><div class="a"><ul><li>${'x'.repeat(150)}</li></ul></div></section>`;
  return `<html><body><main id="m">${Array.from({ length: count }, (_, i) => one(i)).join('')}</main><footer>f</footer></body></html>`;
}

test('切り詰め: 兄弟要素の境目で切れる場合は、開始・終了タグの対応が崩れない', () => {
  const result = buildHtmlSkeleton(sectionsHtml(300));
  assert.equal(result.truncated, true);
  assert.ok(result.includedChars <= MAX_FULL_HTML_CHARS);
  const cut = result.cutStructure;
  assert.equal(cut.endTagMissingCount, 0);
  assert.equal(cut.startTagMissingCount, 0);
  assert.deepEqual(cut.enclosingAtCut, ['html', 'body', 'main#m']);
  // 収録したHTMLだけでタグの対応を数えても崩れていない（目印のコメントは1つのトークン）
  const balance = computeOpenStacks(tokenizeHtml(result.text));
  assert.equal(balance.orphanCloses, 0);
  assert.equal(balance.unclosedAtEnd, 0);
  assert.equal(balance.implicitlyClosed, 0);
});

test('切り詰め: 境目を選べない深い入れ子では、崩れた要素を元HTMLの要素として明記し、タグは補わない', () => {
  // 1つの巨大な入れ子（兄弟の境目が無い）: <div#outer><div.lvl>…が深く続き、中身は短いテキストの連続
  const depth = 400;
  const open = Array.from({ length: depth }, (_, i) => `<div class="lvl l${i}">${'t'.repeat(40)}`).join('');
  // 終了タグ側にもテキストがあり、末尾側の枠に全部の終了タグは入らない
  const close = `${'c'.repeat(40)}</div>`.repeat(depth);
  const html = `<html><body><div id="outer">${open}${close}</div></body></html>`;
  const result = buildHtmlSkeleton(html);
  assert.equal(result.truncated, true);
  assert.ok(result.includedChars <= MAX_FULL_HTML_CHARS);

  const cut = result.cutStructure;
  assert.ok(cut.endTagMissingCount > 0);
  assert.equal(cut.startTagMissingCount, 0);
  assert.deepEqual(cut.enclosingAtCut.slice(0, 3), ['html', 'body', 'div#outer']);
  assert.match(cut.endTagMissing[0], /^div\.lvl\.l\d+$/);

  // 補っていない: 収録したHTMLの終了タグの数は、元の末尾側にあったものだけ
  const [head, tail] = result.text.split(/\n<!-- \[WDP\][^\n]*-->\n/);
  assert.ok(!head.includes('</div>'));
  const tailCloses = (tail.match(/<\/div>/g) || []).length;
  assert.ok(tailCloses <= depth + 1);
  assert.match(result.text, /終了タグが欠けた要素 \d+個/);
  assert.match(result.text, /欠けたタグは補っていません/);

  const md = buildFullTextSections(baseData({ html }));
  assert.match(md, /- 終了タグが欠けた要素（開始タグは先頭側にあり、終了タグは省略範囲）: [1-9]\d*個 `div\.lvl\.l\d+`/);
  assert.match(md, /欠けたタグは補っていません。収録したHTMLをそのまま貼り付けても、元のページと同じ入れ子にはなりません/);
  assert.match(md, /ブラウザが作るDOMと一致するとは限りません/);
});

test('切り詰め: 開始タグが省略範囲にあり終了タグだけ末尾側に残る要素を区別して数える', () => {
  // 先頭は浅く、末尾が深い入れ子で終わる（末尾側に開始タグの無い終了タグが残る）
  const head = Array.from({ length: 200 }, (_, i) => `<p id="p${i}">${'h'.repeat(80)}</p>`).join('');
  const deepOpen = Array.from({ length: 300 }, (_, i) => `<span class="d${i}">${'z'.repeat(30)}`).join('');
  const deepClose = Array.from({ length: 300 }, () => `${'z'.repeat(30)}</span>`).join('');
  const html = `<body>${head}<article id="art">${deepOpen}${deepClose}</article></body>`;
  const result = buildHtmlSkeleton(html);
  const cut = result.cutStructure;
  assert.ok(cut.startTagMissingCount > 0);
  assert.equal(cut.orphanEndTagsInTailCount, cut.startTagMissingCount);
  assert.equal(computeOpenStacks(tokenizeHtml(result.text)).orphanCloses, cut.orphanEndTagsInTailCount);
});

test('タグの対応の簡易計算: void要素・自己終了・終了タグ省略・対応の無い終了タグ', () => {
  const tokens = tokenizeHtml('<div><img src=a><br/><p>a<p>b</div></span><svg><path d="M0"/></svg><ul><li>x');
  const r = computeOpenStacks(tokens);
  assert.equal(r.implicitlyClosed, 2); // </div> で閉じた p 2つ
  assert.equal(r.orphanCloses, 1); // </span>
  assert.equal(r.unclosedAtEnd, 2); // ul, li
  const md = buildFullTextSections(baseData({ html: '<div><p>a</div></span>' }));
  assert.match(md, /元HTMLのタグの対応（簡易計算）: 終了タグなしで閉じた要素 1個 \/ 最後まで閉じていない要素 0個 \/ 対応する開始タグのない終了タグ 1個/);
});

// -----------------------------------------------
// PR #100 レビュー対応: 全文つき版の全体（先頭の通常版部分を含む）
// -----------------------------------------------
function hostileData() {
  const evil = 'x = "```"; </script><script>alert(1)</script> token: "abcdefghijklmnop1234" a@b.example';
  return baseData({
    title: '<script>alert("title")</script> ``` boss@corp.example',
    finalUrl: 'https://example.com/redirect?token=abcdefghijklmnop9999&<b>x</b>',
    cssExcerpts: CSS_EXCERPT_CATEGORIES.map(({ key, label }, i) => ({
      key, label, excerpts: i === 0 ? [{ keyword: 'body', source: 'インラインstyle #1', excerpt: '</style><img src=x onerror=alert(2)> body{}' }] : [],
    })),
    jsExcerpts: JS_EXCERPT_CATEGORIES.map(({ key, label }, i) => ({
      key, label, excerpts: i === 0 ? [{ keyword: 'canvas', source: 'https://example.com/a`<i>`.js', excerpt: evil }] : [],
    })),
    cssResources: [{ label: 'https://cdn.other/<svg onload=alert(3)>.css', status: 'skipped_external' }],
    dangerFindings: [{ label: 'HTML', type: 'メールアドレス', preview: 'boss...mple' }],
  });
}

test('全文つき版の全体: ページ由来のHTML/スクリプト文字列がコードの外に出ない', () => {
  const md = buildFullMarkdown(hostileData());
  for (const line of linesOutsideFences(md)) {
    const plain = stripInlineCode(line);
    assert.ok(!/<script|<\/script|<img|<\/style|<svg|<b>|<i>|onerror|onload|alert\(/i.test(plain), `フェンスの外に出ています: ${line}`);
  }
  // 固定の説明文も、全文つき版ではインラインコードにしている
  assert.ok(md.includes('- HTMLの `<script src>` と `<link rel="stylesheet">` 以外の方法で読み込まれるコード'));
});

test('全文つき版の全体: タイトル・URL・抜粋・危険情報チェック欄の機密情報らしい値を載せない', () => {
  const md = buildFullMarkdown(hostileData());
  for (const secret of ['abcdefghijklmnop1234', 'abcdefghijklmnop9999', 'a@b.example', 'boss@corp.example', 'boss...mple']) {
    assert.ok(!md.includes(secret), `${secret} が残っています`);
  }
  assert.match(md, /- \[`HTML`\] メールアドレス（値は全文つき版には載せません/);
  assert.match(md, /- ページタイトル: `+ ?<script>alert\("title"\)<\/script> ``` \[WDP:マスク済み\] ?`+/);
});

test('通常版は、危険な入力でも従来どおりの書き方のまま（全文つき版の安全処理が混ざらない）', () => {
  const md = buildMarkdown(hostileData());
  assert.ok(md.includes('- ページタイトル: <script>alert("title")</script> ``` boss@corp.example'));
  assert.ok(md.includes('- [HTML] メールアドレス: `boss...mple`'));
  assert.ok(md.includes('```\nx = "```"; </script>'));
  assert.ok(!md.includes(MASK_MARKER));
  assert.ok(md.includes('- HTMLの<script src>と<link rel="stylesheet">以外の方法で読み込まれるコード'));
});

test('メールアドレスのパターン: 英数字の長い連続でも時間がかからず、検出結果は従来と同じ', () => {
  const blob = 'A'.repeat(MAX_RESOURCE_CHARS);
  const started = Date.now();
  assert.equal(maskSensitive(blob).count, 0);
  assert.deepEqual(checkDangerousContent([{ label: 'X', text: blob }]), []);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started}ms`);

  // 後読みを付ける前と同じ文字列が見つかる
  const text = 'mail: foo.bar+x@example.co.jp, <a@b.cd> x-y_z@q.io icon@2x.png';
  const oldRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const found = checkDangerousContent([{ label: 'X', text }]).filter((f) => f.type === 'メールアドレス');
  const expected = (text.match(oldRegex) || []).slice(0, 3);
  assert.equal(found.length, expected.length);
  assert.equal(maskSensitive(text).text.match(/\[WDP:マスク済み\]/g).length, text.match(oldRegex).length);
});
