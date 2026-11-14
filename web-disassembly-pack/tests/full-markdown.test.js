import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown, buildFullMarkdown } from '../js/markdown.js';
import { createFullFetchCache, runFullFetch, toFullResources, DEFAULT_FULL_FETCH_LIMITS } from '../js/full-fetch.js';
import { checkDangerousContent } from '../js/danger-check.js';
import { truncateForAnalysis, buildInlineEntry } from '../js/coverage.js';
import { JS_FEATURE_CHECKS, CSS_EXCERPT_CATEGORIES, JS_EXCERPT_CATEGORIES } from '../js/keywords.js';
import { LIBRARY_CHECKS } from '../js/libraries.js';
import { MAX_FULL_CODE_CHARS, MAX_FULL_HTML_CHARS } from '../js/constants.js';

// -----------------------------------------------
// TodoMVC の構成（外部JS 8件。通常解析は先頭5件だけ）を模した入力
// -----------------------------------------------
const ORIGIN = 'https://todo.example';
const NAMES = ['base.js', 'helpers.js', 'store.js', 'model.js', 'template.js', 'view.js', 'controller.js', 'app.js'];
const url = (name) => `${ORIGIN}/js/${name}`;
const BODY = (name) => `/* ${name} */\nwindow.${name.replace('.js', '')} = function () { return '${name}'; };`;

function baseData(overrides = {}) {
  const jsScripts = NAMES.map((name) => ({ url: url(name), sameOrigin: true }));
  const jsResources = jsScripts.map((s, i) => (i < 5
    ? { label: s.url, status: 'ok', ...truncateForAnalysis(BODY(NAMES[i])) }
    : { label: s.url, status: 'skipped_limit' }));
  return {
    pageUrl: `${ORIGIN}/`,
    finalUrl: `${ORIGIN}/`,
    title: 'Todo',
    structure: { canvas: 0, button: 1, audio: 0, video: 0, svg: 0, inlineScriptCount: 1, externalScriptCount: 8, inlineStyleCount: 0, externalStylesheetCount: 0 },
    jsFeatures: JS_FEATURE_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    libraries: LIBRARY_CHECKS.map(({ key, label }) => ({ key, label, value: 'なし' })),
    cssExcerpts: CSS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    jsExcerpts: JS_EXCERPT_CATEGORIES.map(({ key, label }) => ({ key, label, excerpts: [] })),
    cssResources: [],
    jsResources,
    dangerFindings: [],
    htmlChars: 100,
    inlineStyles: [],
    inlineScripts: [buildInlineEntry('window.BOOT = true;', 'インラインscript #1')],
    html: `<html><body><section id="todoapp"></section><script>window.BOOT = true;</script>${NAMES.map((n) => `<script src="js/${n}"></script>`).join('')}</body></html>`,
    jsScripts,
    scriptOrder: [
      { kind: 'inline', label: 'インラインscript #1', chars: 19, type: '', module: false, async: false, defer: false, nomodule: false },
      ...jsScripts.map((s, i) => ({ kind: 'external', url: s.url, sameOrigin: true, type: i === 7 ? 'module' : '', module: i === 7, async: false, defer: i === 6, nomodule: false })),
    ],
    ...overrides,
  };
}

/** main.js の流れ（handleFullMarkdown → finishFullMarkdown → fullMarkdownData）と同じ形の full を作る */
async function fullFor(data, behavior = {}, runs = []) {
  const cache = data.cache || createFullFetchCache(data.cssResources, data.jsResources);
  const fetchFn = async (u) => behavior[u] || { ok: true, content: BODY(u.split('/').pop()) };
  const run = await runFullFetch({ cssLinks: [], jsScripts: data.jsScripts, cache, fetchFn });
  runs.push({ log: run.log, stats: run.stats });
  const extras = [...cache.values()].filter((e) => e.source === 'extra');
  const dangerFindings = checkDangerousContent(extras.map((e) => ({ label: e.label, text: e.rawText })));
  return {
    cache,
    full: {
      cssResources: toFullResources(run.candidates, cache, 'CSS'),
      jsResources: toFullResources(run.candidates, cache, 'JS'),
      candidates: run.candidates,
      runs,
      lastRun: run,
      dangerFindings,
      extraFileCount: extras.length,
      scriptOrder: data.scriptOrder,
      limits: DEFAULT_FULL_FETCH_LIMITS,
    },
  };
}

function section(md, heading) {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `${heading} がありません`);
  const next = md.indexOf('\n### ', start + heading.length);
  return md.slice(start, next === -1 ? undefined : next);
}

// -----------------------------------------------
// テスト
// -----------------------------------------------
test('追加取得: 通常解析で件数上限だった view/controller/app が全文つき版に収録され、取得状態と収録状態が一致する', async () => {
  const data = baseData();
  const { full } = await fullFor(data);
  const md = buildFullMarkdown({ ...data, full });

  for (const name of ['view.js', 'controller.js', 'app.js']) {
    // 通常解析の節（先頭部分）: 通常解析の事実＋全文つき版での状態
    assert.ok(md.includes(`- [JS] \`${url(name)}\`: 取得対象外（取得件数の上限を超過） → 全文つき版: 追加取得で取得`), name);
    // 取得状態の節
    assert.ok(md.includes(`\`${url(name)}\`\n   - 通常解析: 件数上限（各5件）のため対象外 / 全文つき版: 追加取得で取得 / 収録: 全文`), name);
    // 本文
    assert.ok(md.includes(`#### [JS・外部（同一オリジン・全文つき版で追加取得）] \`${url(name)}\``), name);
    assert.ok(md.includes(BODY(name)), name);
  }
  for (const name of ['base.js', 'helpers.js']) {
    assert.ok(md.includes(`\`${url(name)}\`\n   - 通常解析: 取得 / 全文つき版: 通常解析で取得済み（再利用） / 収録: 全文`), name);
  }
  // 収録しなかったコードに、取得済みのファイルは出てこない
  assert.ok(!section(md, '### 収録しなかったコード').includes('view.js'));
  assert.match(md, /- 今回の全文生成での通信: 3件（成功3件・失敗0件・タイムアウト0件/);
});

test('通常版: 全文つき版用の追加取得の記録があっても、通常版の出力は変わらない', async () => {
  const data = baseData();
  const { full } = await fullFor(data);
  assert.equal(buildMarkdown({ ...data, full }), buildMarkdown(data));
  assert.ok(!buildMarkdown(data).includes('全文つき版'));
});

test('取得失敗: 成功扱いにせず、本文を収録しない。理由と「次回再試行」を全節で同じように示し、次回は失敗分だけ通信する', async () => {
  const data = baseData();
  const runs = [];
  const failing = { [url('controller.js')]: { ok: false, reason: 'http_error', httpStatus: 503 } };
  const first = await fullFor(data, failing, runs);
  const md = buildFullMarkdown({ ...data, full: first.full });

  const failText = '取得失敗（理由: HTTPエラー 503）。成功扱いにせず、次回の全文生成で再試行します';
  assert.ok(md.includes(`- [JS] \`${url('controller.js')}\`: 取得対象外（取得件数の上限を超過） → 全文つき版: ${failText}`));
  assert.ok(md.includes(`\`${url('controller.js')}\`\n   - 通常解析: 件数上限（各5件）のため対象外 / 全文つき版: ${failText} / 収録: なし（本文を取得していない）`));
  assert.ok(section(md, '### 収録しなかったコード').includes(`- [JS] \`${url('controller.js')}\`: ${failText}`));
  assert.ok(!md.includes(BODY('controller.js')));
  assert.match(md, /もう一度「全文つきでMarkdownを作る」を押すと、そのファイルだけを再試行します/);

  // 2回目: 失敗分だけを通信し、成功すると収録される。通信記録は回ごとに分けて残る
  const called = [];
  const cache = first.cache;
  const second = await fullFor({ ...data, cache }, new Proxy({}, { get: (t, u) => { called.push(u); return undefined; } }), runs);
  assert.deepEqual(called, [url('controller.js')]);
  const md2 = buildFullMarkdown({ ...data, full: second.full });
  assert.ok(md2.includes(BODY('controller.js')));
  assert.ok(md2.includes('#### 1回目の全文生成（通信3件）'));
  assert.ok(md2.includes('#### 2回目の全文生成（通信1件）'));
  assert.ok(!md2.includes('次回の全文生成で再試行します'));
});

test('タイムアウト・時間切れ: 状態を区別して記録し、本文を収録しない', async () => {
  const data = baseData();
  const { full } = await fullFor(data, { [url('view.js')]: { ok: false, reason: 'timeout' } });
  full.candidates.find((c) => c.url === url('app.js')).status = 'skipped_time';
  full.jsResources = toFullResources(full.candidates, new Map([...full.jsResources].filter((r) => r.status === 'ok').map((r) => [r.label, r])), 'JS');
  const md = buildFullMarkdown({ ...data, full });
  assert.ok(md.includes(`\`${url('view.js')}\`: 取得対象外（取得件数の上限を超過） → 全文つき版: タイムアウト（20秒）（理由: タイムアウト）。成功扱いにせず、次回の全文生成で再試行します`));
  assert.ok(md.includes(`\`${url('app.js')}\`: 取得対象外（取得件数の上限を超過） → 全文つき版: 追加取得の全体の時間上限に達したため未試行。次回の全文生成で再試行します`));
  assert.ok(!md.includes(BODY('view.js')));
  assert.ok(!md.includes(BODY('app.js')));
});

test('記述順と取得順: scriptの記述順（属性つき）と、通信を試行した順を別の節に分けて示す', async () => {
  const data = baseData();
  const { full } = await fullFor(data);
  const md = buildFullMarkdown({ ...data, full });
  const order = section(md, '### scriptの記述順と属性（実行順の手がかり）');
  assert.ok(order.includes('1. [インライン] `インラインscript #1`（19文字） 属性: なし'));
  assert.ok(order.includes(`8. [外部] \`${url('controller.js')}\` 属性: \`defer\` / 取得: 追加取得で取得`));
  assert.ok(order.includes(`9. [外部] \`${url('app.js')}\` 属性: \`type="module"\` / 取得: 追加取得で取得`));
  assert.match(order, /取得した順番（上の通信記録）とは別です/);
  const log = section(md, '### 追加取得の通信記録（試行した順）');
  assert.ok(log.includes(`1. [JS] \`${url('view.js')}\`: 成功`));
  assert.ok(log.includes(`3. [JS] \`${url('app.js')}\`: 成功`));
  assert.ok(!log.includes('base.js'), '通常解析で取得したファイルは通信記録に出ない');
});

test('危険情報: 追加取得分は通常解析分と区別して記載し、値は載せず、本文ではマスクする', async () => {
  const data = baseData({ dangerFindings: [] });
  const { full } = await fullFor(data, { [url('app.js')]: { ok: true, content: 'const awsKey = "AKIAABCDEFGHIJKLMNOP";' } });
  assert.equal(full.dangerFindings.length, 1);
  const md = buildFullMarkdown({ ...data, full });

  const head = section(md, '## 危険情報チェック結果');
  assert.ok(head.includes('通常解析で取得した範囲の結果です'));
  assert.ok(head.includes('チェック対象のパターンは検出されませんでした。'));
  const extra = section(md, '### 危険情報チェック（全文つき版の追加取得分）');
  assert.ok(extra.includes('全文つき版で追加取得したファイル 3件'));
  assert.ok(extra.includes(`  - [\`${url('app.js')}\`] AWSアクセスキーID`));
  assert.ok(!md.includes('AKIAABCDEFGHIJKLMNOP'));
  assert.ok(!md.includes('AKIA...MNOP'));
  assert.ok(md.includes('const awsKey = "[WDP:マスク済み]";'));
});

test('上限: 追加取得分が多く大きくても、HTML構造20,000文字・CSS/JS本文100,000文字を超えず、収録は小さいファイルから', async () => {
  const many = Array.from({ length: 20 }, (_, i) => `f${i + 1}.js`);
  const jsScripts = many.map((n) => ({ url: url(n), sameOrigin: true }));
  const sizes = Object.fromEntries(many.map((n, i) => [url(n), 3000 + (19 - i) * 1500]));
  const data = baseData({
    jsScripts,
    jsResources: jsScripts.map((s, i) => (i < 5 ? { label: s.url, status: 'ok', ...truncateForAnalysis('b'.repeat(sizes[s.url])) } : { label: s.url, status: 'skipped_limit' })),
    html: `<html><body>${'<p>x</p>'.repeat(5000)}</body></html>`,
  });
  const behavior = Object.fromEntries(jsScripts.map((s) => [s.url, { ok: true, content: 'e'.repeat(sizes[s.url]) }]));
  const { full } = await fullFor(data, behavior);
  const md = buildFullMarkdown({ ...data, full });

  const fences = [...md.slice(md.indexOf('## 全文収録')).matchAll(/^```(\w+)\n([\s\S]*?)\n```$/gm)];
  const code = fences.filter((m) => m[1] !== 'html').reduce((n, m) => n + m[2].length, 0);
  const html = fences.filter((m) => m[1] === 'html').reduce((n, m) => n + m[2].length, 0);
  assert.ok(code <= MAX_FULL_CODE_CHARS, `${code}`);
  assert.ok(html <= MAX_FULL_HTML_CHARS, `${html}`);
  // 小さい順に収録優先順が付き、最小のファイル（f20）が優先順2（インラインの次）
  assert.match(md, new RegExp(`\\[JS・外部（同一オリジン・全文つき版で追加取得）\\] \`${url('f20.js').replace(/\./g, '\\.')}\`\\n\\n- 元の文字数: 3000文字\\n- 解析範囲: 3000文字（全文）\\n- 収録優先順: 2`));
  // 大きいファイルは文字数上限で未収録になり、取得状態の節でもそう示す
  assert.ok(md.includes(`\`${url('f1.js')}\`\n   - 通常解析: 取得 / 全文つき版: 通常解析で取得済み（再利用） / 収録: なし（CSS/JS本文の文字数上限のため）`));
});

test('文字数上限で切り詰めた追加取得分は、理由を書き分ける', async () => {
  const data = baseData();
  const limits = { ...DEFAULT_FULL_FETCH_LIMITS, extraChars: 70 };
  const cache = createFullFetchCache(data.cssResources, data.jsResources);
  const run = await runFullFetch({ cssLinks: [], jsScripts: data.jsScripts, cache, limits, fetchFn: async (u) => ({ ok: true, content: BODY(u.split('/').pop()) }) });
  const full = {
    cssResources: [], jsResources: toFullResources(run.candidates, cache, 'JS'), candidates: run.candidates,
    runs: [{ log: run.log, stats: run.stats }], lastRun: run, dangerFindings: [], extraFileCount: 2, scriptOrder: [], limits,
  };
  const md = buildFullMarkdown({ ...data, full });
  assert.ok(md.includes('（全文つき版の追加取得の合計文字数上限で切り詰め。'));
  assert.ok(md.includes(`\`${url('app.js')}\`: 取得対象外（取得件数の上限を超過） → 全文つき版: 追加取得の合計文字数上限に達したため未試行`));
  assert.match(md, /追加取得の合計文字数上限に達したため、途中で追加取得を打ち切りました。/);
});

test('秒の表記: 状態の説明と通信記録で、待ち時間の上限を同じ丸め方で書く', async () => {
  const data = baseData();
  const { full } = await fullFor(data, { [url('view.js')]: { ok: false, reason: 'timeout' } });
  full.runs[0].log[0].timeoutMs = 4900;
  full.candidates.find((c) => c.url === url('view.js')).timeoutMs = 4900;
  const md = buildFullMarkdown({ ...data, full: { ...full, jsResources: toFullResources(full.candidates, full.cache || new Map(full.jsResources.filter((r) => r.status === 'ok').map((r) => [r.label, r])), 'JS') } });
  assert.ok(md.includes('タイムアウト（4.9秒）'));
  assert.ok(md.includes('待ち時間の上限 4.9秒'));
  assert.ok(!md.includes('（5秒）'));
});
