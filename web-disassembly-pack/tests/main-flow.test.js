/**
 * main.js の操作の流れ（取得・解析・やり直し・再解析）のテスト。
 *
 * ブラウザの代わりに、必要な部分だけを持つ作り物の document / DOMParser / fetch を
 * 用意して main.js をそのまま読み込む。Worker への通信は fetch の作り物が受け取り、
 * テスト側が好きな順番で応答を返せるようにしている（非同期の競合を再現するため）。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// -----------------------------------------------
// 作り物の DOM
// -----------------------------------------------
class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.className = '';
    this.children = [];
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
  }

  addEventListener(type, fn) { this.listeners[type] = fn; }
  appendChild(child) { this.children.push(child); }
  removeChild() {}
  focus() {}
  select() {}
  click() {}
}

const INITIALLY_HIDDEN = new Set([
  'step-structure', 'step-danger', 'step-markdown', 'markdown-preview-wrap', 'structure-next-hint',
]);
const elements = new Map();

function el(id) {
  if (!elements.has(id)) {
    const element = new FakeElement(id);
    element.hidden = INITIALLY_HIDDEN.has(id);
    elements.set(id, element);
  }
  return elements.get(id);
}

// ul などの innerHTML = '' で子要素も消えるようにする
function resetChildrenOnClear(element) {
  let html = '';
  Object.defineProperty(element, 'innerHTML', {
    get: () => html,
    set: (value) => { html = value; if (value === '') element.children = []; },
  });
}

// 作り物の DOMParser: <script src="..."> と <script>本文</script> だけを読み取る
class FakeDOMParser {
  parseFromString(html) {
    const scripts = [];
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      const src = (match[1].match(/src="([^"]+)"/) || [])[1] || null;
      scripts.push({ getAttribute: (name) => (name === 'src' ? src : null), textContent: match[2] });
    }
    return {
      title: '',
      querySelectorAll: (selector) => (selector === 'script' ? scripts : []),
    };
  }
}

// 作り物の fetch: 対象URLごとに応答を保留し、テストから respond() で返す
const pending = new Map();

function fakeFetch(endpoint) {
  const target = new URL(endpoint).searchParams.get('url');
  return new Promise((resolve) => {
    pending.set(target, (payload) => resolve({ json: async () => payload }));
  });
}

function respond(url, payload) {
  const resolve = pending.get(url);
  assert.ok(resolve, `${url} への取得要求がありません`);
  pending.delete(url);
  resolve(payload);
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function click(id) {
  return el(id).listeners.click();
}

const PAGE_HTML = '<script src="/app.js"></script><script>const canvas = 1; requestAnimationFrame(draw);</script>';
const okHtml = (html) => ({ ok: true, content: html, contentType: 'text/html', finalUrl: '', httpStatus: 200 });

before(async () => {
  ['library-list', 'js-feature-list', 'structure-cards'].forEach((id) => resetChildrenOnClear(el(id)));

  globalThis.document = {
    getElementById: el,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    body: new FakeElement('body'),
  };
  globalThis.window = { location: { search: '' } };
  globalThis.DOMParser = FakeDOMParser;
  globalThis.fetch = fakeFetch;

  await import('../js/main.js');
});

// -----------------------------------------------
// テスト
// -----------------------------------------------
test('取得中は「URLを取得」を押せず、取得後に戻る', async () => {
  el('url-input').value = 'https://a.example/';
  const done = click('fetch-btn');
  assert.equal(el('fetch-btn').disabled, true);

  respond('https://a.example/', okHtml('<p>no script</p>'));
  await done;
  assert.equal(el('fetch-btn').disabled, false);
  assert.equal(el('step-structure').hidden, false);
});

test('取得に失敗しても「URLを取得」が戻る', async () => {
  el('url-input').value = 'https://fail.example/';
  const done = click('fetch-btn');
  respond('https://fail.example/', { ok: false, reason: 'http_error', httpStatus: 404 });
  await done;
  assert.equal(el('fetch-btn').disabled, false);
  assert.match(el('fetch-status').textContent, /取得に失敗しました/);
  assert.equal(el('step-structure').hidden, true);
});

test('解析中は「URLを取得」「Markdownを作る」を押せず、完了後に戻る', async () => {
  el('url-input').value = 'https://b.example/';
  const fetched = click('fetch-btn');
  respond('https://b.example/', okHtml(PAGE_HTML));
  await fetched;

  const analyzed = click('structure-btn');
  await flush();
  assert.equal(el('fetch-btn').disabled, true);
  assert.equal(el('markdown-btn').disabled, true);
  assert.equal(el('structure-btn').disabled, true);
  assert.equal(el('structure-btn').textContent, '解析中...');

  respond('https://b.example/app.js', okHtml('function draw() {}'));
  await analyzed;
  assert.equal(el('fetch-btn').disabled, false);
  assert.equal(el('markdown-btn').disabled, false);
  assert.equal(el('structure-btn').disabled, false);
  assert.equal(el('structure-btn').textContent, '構造を見る');
  assert.equal(el('step-markdown').hidden, false);
});

test('「構造を見る」を再実行すると、生成済みMarkdownとプレビューが消える', async () => {
  click('markdown-btn');
  assert.equal(el('markdown-preview-wrap').hidden, false);
  assert.ok(el('markdown-preview').value.length > 0);

  const analyzed = click('structure-btn');
  // 再実行を押した直後（外部JSの取得を待っている間）に、もう消えている
  assert.equal(el('markdown-preview').value, '');
  assert.equal(el('markdown-preview-wrap').hidden, true);
  assert.equal(el('step-markdown').hidden, true);
  assert.equal(el('step-danger').hidden, true);

  // 解析途中にMarkdownを作ろうとしても作られない
  click('markdown-btn');
  assert.equal(el('markdown-preview').value, '');

  await flush();
  respond('https://b.example/app.js', okHtml('function draw() {}'));
  await analyzed;
  assert.equal(el('markdown-preview-wrap').hidden, true, '再解析後も、押すまでMarkdownは出ない');
  assert.equal(el('step-markdown').hidden, false);
});

test('解析中に「やり直す」を押すと、古い解析の結果は書き込まれず、ボタンも戻る', async () => {
  const analyzed = click('structure-btn');
  await flush();
  assert.equal(el('structure-btn').textContent, '解析中...');

  click('reset-btn');
  assert.equal(el('fetch-btn').disabled, false);
  assert.equal(el('structure-btn').disabled, false);
  assert.equal(el('structure-btn').textContent, '構造を見る');
  assert.equal(el('step-structure').hidden, true);

  // 古い解析の取得が遅れて返ってきても、画面に何も出ない
  respond('https://b.example/app.js', okHtml('function draw() {}'));
  await analyzed;
  await flush();
  assert.equal(el('step-danger').hidden, true);
  assert.equal(el('step-markdown').hidden, true);
  assert.equal(el('js-feature-list').children.length, 0);
  assert.equal(el('library-list').children.length, 0);
  assert.equal(el('analyzed-url').textContent, '');
});

test('取得中に「やり直す」を押すと、遅れて返ってきたHTMLは使われない', async () => {
  el('url-input').value = 'https://c.example/';
  const fetched = click('fetch-btn');
  click('reset-btn');
  assert.equal(el('fetch-btn').disabled, false);

  respond('https://c.example/', okHtml(PAGE_HTML));
  await fetched;
  assert.equal(el('step-structure').hidden, true);
  assert.equal(el('fetch-status').textContent, '');
});

// 前のテストの状態（失敗して残った保留中の通信を含む）に影響されないよう、最初からやり直す
function startFresh() {
  click('reset-btn');
  pending.clear();
}

const TWO_EXTERNAL_HTML = '<script src="/a.js"></script><script src="/b.js"></script><script>const canvas = 1;</script>';

test('解析中に「やり直す」を押すと、古い解析は残りの外部ファイルを取りに行かない', async () => {
  startFresh();
  el('url-input').value = 'https://stop.example/';
  const fetched = click('fetch-btn');
  respond('https://stop.example/', okHtml(TWO_EXTERNAL_HTML));
  await fetched;

  const analyzed = click('structure-btn');
  await flush();
  assert.ok(pending.has('https://stop.example/a.js'));

  click('reset-btn');
  respond('https://stop.example/a.js', okHtml('A'));
  await flush();
  // 返事を待ち続けて止まらないよう、古い解析の終了を待つ前に確かめる
  assert.ok(!pending.has('https://stop.example/b.js'), '古い解析が b.js を取りに行っています');
  assert.equal(pending.size, 0);
  await analyzed;
});

test('E1: 古い解析の通信が、新しいURLの解析の途中で遅れて返っても混ざらない', async () => {
  startFresh();
  el('url-input').value = 'https://old.example/';
  let fetched = click('fetch-btn');
  respond('https://old.example/', okHtml(TWO_EXTERNAL_HTML));
  await fetched;
  const oldRun = click('structure-btn');
  await flush();

  click('reset-btn');
  el('url-input').value = 'https://new.example/';
  fetched = click('fetch-btn');
  respond('https://new.example/', okHtml(PAGE_HTML));
  await fetched;
  const newRun = click('structure-btn');
  await flush();

  // 新しい解析の途中で、古い解析の通信が返ってくる
  respond('https://old.example/a.js', okHtml('OLD_RESOURCE_MARKER'));
  await flush();
  // 返事を待ち続けて止まらないよう、古い解析の終了を待つ前に確かめる
  assert.ok(!pending.has('https://old.example/b.js'), '古い解析が b.js を取りに行っています');
  await oldRun;
  assert.equal(el('structure-btn').textContent, '解析中...', '新しい解析が古い解析の後始末で止められています');
  assert.equal(el('fetch-btn').disabled, true);

  respond('https://new.example/app.js', okHtml('function draw() {}'));
  await newRun;
  click('markdown-btn');
  const markdown = el('markdown-preview').value;
  assert.ok(markdown.includes('https://new.example/'));
  assert.ok(!markdown.includes('old.example'));
  assert.ok(!markdown.includes('OLD_RESOURCE_MARKER'));
});

test('E2: 解析の途中で例外が出ても、ボタンが戻りメッセージが出る', async () => {
  startFresh();
  // 前のテストに頼らず、このテストで取得したページを解析する
  el('url-input').value = 'https://throw.example/';
  const fetched = click('fetch-btn');
  respond('https://throw.example/', okHtml(PAGE_HTML));
  await fetched;

  const OriginalParser = globalThis.DOMParser;
  globalThis.DOMParser = class { parseFromString() { throw new Error('parse failed'); } };
  try {
    await click('structure-btn');
  } finally {
    globalThis.DOMParser = OriginalParser;
  }
  assert.equal(el('structure-btn').disabled, false);
  assert.equal(el('structure-btn').textContent, '構造を見る');
  assert.equal(el('fetch-btn').disabled, false);
  assert.equal(el('markdown-btn').disabled, false);
  assert.match(el('analyzed-url').textContent, /解析中にエラーが発生しました/);
  assert.equal(el('step-markdown').hidden, true);
  assert.equal(el('markdown-preview').value, '');
});

test('E3: 取得の通信そのものが失敗（reject）しても、ボタンが戻る', async () => {
  startFresh();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('network down'));
  try {
    el('url-input').value = 'https://reject.example/';
    await click('fetch-btn');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(el('fetch-btn').disabled, false);
  assert.match(el('fetch-status').textContent, /取得に失敗しました（通信エラー）/);
  assert.equal(el('step-structure').hidden, true);
});

// -----------------------------------------------
// 全文つきMarkdown（v0.4.0）
// -----------------------------------------------
const FULL_PAGE_HTML = '<script src="/app.js"></script><script>const canvas = 1; drawInline();</script>';

async function analyzeFresh(url, appJs) {
  startFresh();
  el('url-input').value = url;
  const fetched = click('fetch-btn');
  respond(url, okHtml(FULL_PAGE_HTML));
  await fetched;
  const analyzed = click('structure-btn');
  await flush();
  return { analyzed, finish: async () => { respond(new URL('/app.js', url).href, okHtml(appJs)); await analyzed; } };
}

test('F1: 解析中は「全文つきでMarkdownを作る」も押せず、完了後に戻る', async () => {
  const run = await analyzeFresh('https://full.example/', 'function appBody() {}');
  assert.equal(el('markdown-full-btn').disabled, true);
  click('markdown-full-btn');
  assert.equal(el('markdown-preview').value, '', '解析途中に全文つきMarkdownが作られています');
  await run.finish();
  assert.equal(el('markdown-full-btn').disabled, false);
});

test('F2: 全文つきは本文を収録し、通常版は収録しない（ボタンごとに独立）', async () => {
  click('markdown-full-btn');
  const full = el('markdown-preview').value;
  assert.ok(full.includes('## 全文収録（全文つき版のみ）'));
  assert.ok(full.includes('function appBody() {}'));
  assert.ok(full.includes('const canvas = 1; drawInline();'));
  assert.match(el('markdown-variant').textContent, /全文つき/);

  click('markdown-btn');
  const normal = el('markdown-preview').value;
  assert.ok(!normal.includes('全文収録'));
  assert.ok(!normal.includes('function appBody() {}'));
  assert.match(el('markdown-variant').textContent, /通常版/);

  // 通常版 → 全文つき → 通常版 で、通常版の内容は同じ
  click('markdown-full-btn');
  click('markdown-btn');
  assert.equal(el('markdown-preview').value, normal);
});

test('F3: 再解析すると全文つきMarkdownも消え、新しい解析結果で作り直される', async () => {
  click('markdown-full-btn');
  assert.ok(el('markdown-preview').value.includes('function appBody() {}'));

  const analyzed = click('structure-btn');
  assert.equal(el('markdown-preview').value, '');
  assert.equal(el('markdown-variant').textContent, '');
  click('markdown-full-btn');
  assert.equal(el('markdown-preview').value, '', '再解析中に古い結果で全文つきが作られています');

  await flush();
  respond('https://full.example/app.js', okHtml('function appBodyV2() {}'));
  await analyzed;
  click('markdown-full-btn');
  const full = el('markdown-preview').value;
  assert.ok(full.includes('function appBodyV2() {}'));
  assert.ok(!full.includes('function appBody() {}'));
});

test('F4: 解析中に「やり直す」→別URLの全文つきに、古いページの本文が混ざらない', async () => {
  const old = await analyzeFresh('https://oldfull.example/', 'OLD_FULL_MARKER()');
  click('reset-btn');
  respond('https://oldfull.example/app.js', okHtml('OLD_FULL_MARKER()'));
  await old.analyzed;

  const fresh = await analyzeFresh('https://newfull.example/', 'NEW_FULL_MARKER()');
  await fresh.finish();
  click('markdown-full-btn');
  const full = el('markdown-preview').value;
  assert.ok(full.includes('NEW_FULL_MARKER()'));
  assert.ok(!full.includes('OLD_FULL_MARKER'));
  assert.ok(!full.includes('oldfull.example'));

  click('reset-btn');
  assert.equal(el('markdown-preview').value, '');
  assert.equal(el('markdown-variant').textContent, '');
  assert.equal(el('markdown-full-btn').disabled, false);
});
