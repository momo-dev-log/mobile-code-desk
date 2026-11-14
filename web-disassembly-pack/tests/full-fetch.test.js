import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFullFetchCache,
  planFullFetch,
  runFullFetch,
  resolveWithoutFetch,
  toFullResources,
  DEFAULT_FULL_FETCH_LIMITS,
} from '../js/full-fetch.js';
import { truncateForAnalysis } from '../js/coverage.js';
import {
  FULL_MAX_CSS_FILES,
  FULL_MAX_JS_FILES,
  FULL_FETCH_PER_REQUEST_MS,
  FULL_FETCH_TOTAL_MS,
  FULL_EXTRA_MAX_CHARS,
  MAX_CSS_FILES,
  MAX_JS_FILES,
  MAX_RESOURCE_CHARS,
} from '../js/constants.js';

// -----------------------------------------------
// 補助
// -----------------------------------------------
const ORIGIN = 'https://site.example';
const js = (n) => ({ url: `${ORIGIN}/s${n}.js`, sameOrigin: true });
const css = (n) => ({ url: `${ORIGIN}/c${n}.css`, sameOrigin: true });
const okEntry = (url, text = `/* ${url} */`) => ({ label: url, status: 'ok', ...truncateForAnalysis(text) });

/** 通常解析と同じ形の結果（先頭から maxCount 件を取得、残りは skipped_limit） */
function baseEntries(links, maxCount, fail = new Set()) {
  let used = 0;
  return links.map((link) => {
    if (!link.sameOrigin) return { label: link.url, status: 'skipped_external' };
    if (used >= maxCount) return { label: link.url, status: 'skipped_limit' };
    used += 1;
    return fail.has(link.url) ? { label: link.url, status: 'failed', reason: '通信エラー' } : okEntry(link.url);
  });
}

/** 通信の作り物。呼ばれたURLと渡された待ち時間を記録する */
function fakeFetch(behavior = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, timeoutMs: options.timeoutMs });
    const b = behavior[url];
    if (typeof b === 'function') return b(url, options);
    if (b) return b;
    return { ok: true, content: `// body of ${url}`, contentType: 'text/javascript', finalUrl: url, httpStatus: 200 };
  };
  return { fn, calls };
}

// -----------------------------------------------
// 上限・数え方
// -----------------------------------------------
test('全文つき版の上限は CSS 10件・JS 20件、時間は1件20秒・全体60秒、追加分は200万文字（通常版の上限は変えない）', () => {
  assert.equal(FULL_MAX_CSS_FILES, 10);
  assert.equal(FULL_MAX_JS_FILES, 20);
  assert.equal(FULL_FETCH_PER_REQUEST_MS, 20000);
  assert.equal(FULL_FETCH_TOTAL_MS, 60000);
  assert.equal(FULL_EXTRA_MAX_CHARS, 2000000);
  assert.equal(MAX_CSS_FILES, 5);
  assert.equal(MAX_JS_FILES, 5);
  assert.equal(MAX_RESOURCE_CHARS, 200 * 1024);
});

test('計画: 通常解析の取得分を含めて上限まで。取得済みは再利用し、通信しない', () => {
  const jsLinks = Array.from({ length: 25 }, (_, i) => js(i + 1));
  const cssLinks = Array.from({ length: 12 }, (_, i) => css(i + 1));
  const cache = createFullFetchCache(baseEntries(cssLinks, 5), baseEntries(jsLinks, 5));
  const plan = planFullFetch({ cssLinks, jsScripts: jsLinks, cache });

  const actions = (type) => plan.candidates.filter((c) => c.type === type).map((c) => c.action);
  assert.deepEqual(actions('JS'), [...Array(5).fill('reuse'), ...Array(15).fill('attempt'), ...Array(5).fill('skipped_full_limit')]);
  assert.deepEqual(actions('CSS'), [...Array(5).fill('reuse'), ...Array(5).fill('attempt'), ...Array(2).fill('skipped_full_limit')]);
  assert.equal(plan.attempts, 20);
});

test('計画: 同じURLは1件にまとめて1回だけ通信し、外部オリジンは試行も枠の消費もしない', () => {
  const jsLinks = [js(1), js(2), js(1), { url: 'https://cdn.example/x.js', sameOrigin: false }, js(3), js(2)];
  const cache = createFullFetchCache([], []);
  const plan = planFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, limits: { ...DEFAULT_FULL_FETCH_LIMITS, js: 3 } });
  const list = plan.candidates.map((c) => [c.url.replace(ORIGIN, ''), c.action, c.references]);
  assert.deepEqual(list, [
    ['/s1.js', 'attempt', 2],
    ['/s2.js', 'attempt', 2],
    ['https://cdn.example/x.js', 'skipped_external', 1],
    ['/s3.js', 'attempt', 1],
  ]);
});

test('通信: 失敗も1件として上限に数える（失敗した分、後ろのファイルは試行しない）', async () => {
  const jsLinks = Array.from({ length: 22 }, (_, i) => js(i + 1));
  const cache = createFullFetchCache([], baseEntries(jsLinks, 5));
  const { fn, calls } = fakeFetch({
    [js(7).url]: { ok: false, reason: 'http_error', httpStatus: 404 },
    [js(8).url]: { ok: false, reason: 'network' },
  });
  const run = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: fn });

  assert.equal(calls.length, 15, '通常解析の5件＋通信15件で上限20件');
  const status = Object.fromEntries(run.candidates.map((c) => [c.url.replace(`${ORIGIN}/`, ''), c.status]));
  assert.equal(status['s7.js'], 'failed');
  assert.equal(status['s8.js'], 'failed');
  assert.equal(status['s20.js'], 'ok');
  assert.equal(status['s21.js'], 'skipped_full_limit');
  assert.equal(status['s22.js'], 'skipped_full_limit');
  assert.equal(run.stats.attempts, 15);
  assert.equal(run.stats.failed, 2);
  assert.equal(run.retryable, true);
  assert.ok(!cache.has(js(7).url), '失敗は成功扱いにしない（保存しない）');
});

test('再試行: 次回の全文生成では失敗・タイムアウトだけを通信し、成功分は再利用する', async () => {
  const jsLinks = Array.from({ length: 8 }, (_, i) => js(i + 1));
  const cache = createFullFetchCache([], baseEntries(jsLinks, 5));
  const first = fakeFetch({
    [js(6).url]: { ok: false, reason: 'timeout' },
    [js(8).url]: { ok: false, reason: 'network' },
  });
  const run1 = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: first.fn });
  assert.deepEqual(first.calls.map((c) => c.url), [js(6).url, js(7).url, js(8).url]);
  assert.equal(run1.candidates.find((c) => c.url === js(6).url).status, 'timeout');

  const second = fakeFetch();
  const run2 = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: second.fn });
  assert.deepEqual(second.calls.map((c) => c.url), [js(6).url, js(8).url], '取得済みの s7 は再取得しない');
  assert.ok(run2.candidates.every((c) => c.status === 'ok'));
  assert.equal(run2.retryable, false);

  // すべて取得済みなら、計画上の通信は0件（通信せずに作れる）
  const plan3 = planFullFetch({ cssLinks: [], jsScripts: jsLinks, cache });
  assert.equal(plan3.attempts, 0);
  const resolved = resolveWithoutFetch(plan3, cache);
  assert.equal(resolved.fetched, false);
  assert.deepEqual(resolved.candidates.map((c) => c.source), ['base', 'base', 'base', 'base', 'base', 'extra', 'extra', 'extra']);
});

// -----------------------------------------------
// 時間の上限
// -----------------------------------------------
function fakeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('時間: 各通信の待ち時間は min(20秒, 全体の残り時間)。60秒に達したら残りは試行せず、再試行の対象にする', async () => {
  const clock = fakeClock();
  const jsLinks = Array.from({ length: 6 }, (_, i) => js(i + 1));
  const cache = createFullFetchCache([], []);
  // 1件目は25秒かかってタイムアウト扱い、2件目以降は18秒ずつかかる
  const { fn, calls } = fakeFetch({
    [js(1).url]: (url, { timeoutMs }) => { clock.advance(timeoutMs); return { ok: false, reason: 'timeout' }; },
  });
  // 実物の fetchResource と同じく、待ち時間の上限で打ち切ってタイムアウトを返す
  const slow = async (url, options) => {
    const r = await fn(url, options);
    if (url === js(1).url) return r;
    clock.advance(Math.min(18000, options.timeoutMs));
    return 18000 > options.timeoutMs ? { ok: false, reason: 'timeout' } : r;
  };
  const run = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: slow, now: clock.now });

  // 経過: 0→20秒（1件目タイムアウト）→38秒→56秒→（残り4秒で打ち切り）60秒→残り0で以降は試行しない
  assert.deepEqual(calls.map((c) => c.timeoutMs), [20000, 20000, 20000, 4000]);
  const status = run.candidates.map((c) => c.status);
  assert.deepEqual(status, ['timeout', 'ok', 'ok', 'timeout', 'skipped_time', 'skipped_time']);
  assert.equal(run.candidates[3].timeoutMs, 4000);
  assert.equal(run.stats.stoppedBy, 'time');
  assert.equal(run.retryable, true);
  assert.equal(run.stats.elapsedMs, 60000);
});

// -----------------------------------------------
// 文字数の上限
// -----------------------------------------------
test('文字数: 追加取得の解析範囲の合計が上限に達したら、残りの文字数まで切り詰めて理由を記録し、残りは試行しない', async () => {
  const jsLinks = [js(1), js(2), js(3)];
  const cache = createFullFetchCache([], []);
  const limits = { ...DEFAULT_FULL_FETCH_LIMITS, extraChars: 1000 };
  const body = 'x'.repeat(600);
  const { fn, calls } = fakeFetch(Object.fromEntries(jsLinks.map((l) => [l.url, { ok: true, content: body }])));
  const run = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: fn, limits });

  assert.equal(calls.length, 2);
  assert.deepEqual(run.candidates.map((c) => c.status), ['ok', 'ok', 'skipped_budget']);
  const second = cache.get(js(2).url);
  assert.equal(second.analyzedChars, 400);
  assert.equal(second.size, 600);
  assert.equal(second.truncated, true);
  assert.equal(second.truncatedBy, 'extra_budget');
  assert.equal(run.stats.stoppedBy, 'budget');
  assert.equal(run.stats.extraChars, 1000);
  assert.equal(run.retryable, false, '文字数上限は再試行しても変わらない');

  // 次回: 上限に達しているので通信しない
  const plan = planFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, limits });
  assert.equal(plan.attempts, 0);
  assert.equal(plan.candidates[2].action, 'skipped_budget');
});

test('文字数: 1ファイルの解析範囲の上限（200KiB）は通常解析と同じ', async () => {
  const cache = createFullFetchCache([], []);
  const { fn } = fakeFetch({ [js(1).url]: { ok: true, content: 'y'.repeat(MAX_RESOURCE_CHARS + 10) } });
  await runFullFetch({ cssLinks: [], jsScripts: [js(1)], cache, fetchFn: fn });
  const entry = cache.get(js(1).url);
  assert.equal(entry.analyzedChars, MAX_RESOURCE_CHARS);
  assert.equal(entry.size, MAX_RESOURCE_CHARS + 10);
  assert.equal(entry.truncatedBy, 'per_file');
});

// -----------------------------------------------
// 失敗の扱い・中断
// -----------------------------------------------
test('通信関数の例外・本文の無い応答は失敗として扱い、成功扱いにしない', async () => {
  const cache = createFullFetchCache([], []);
  const { fn } = fakeFetch({
    [js(1).url]: () => { throw new Error('boom'); },
    [js(2).url]: { ok: true },
  });
  const run = await runFullFetch({ cssLinks: [], jsScripts: [js(1), js(2)], cache, fetchFn: fn });
  assert.deepEqual(run.candidates.map((c) => [c.status, c.reason]), [['failed', 'network'], ['failed', 'network']]);
  assert.equal(cache.size, 0);
});

test('中断: やり直し・再解析で無効になったら、それ以降は通信せず結果を返さない', async () => {
  let cancelled = false;
  const cache = createFullFetchCache([], []);
  const { fn, calls } = fakeFetch({ [js(1).url]: () => { cancelled = true; return { ok: true, content: 'a' }; } });
  const run = await runFullFetch({ cssLinks: [], jsScripts: [js(1), js(2), js(3)], cache, fetchFn: fn, isCancelled: () => cancelled });
  assert.equal(run.cancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(run.candidates, undefined);
});

test('全文Markdown用の記録: 成功分は本文つき、それ以外は状態と理由。HTMLの参照順', async () => {
  const jsLinks = [js(1), js(2), js(3)];
  const cache = createFullFetchCache([], baseEntries(jsLinks, 1));
  const { fn } = fakeFetch({ [js(3).url]: { ok: false, reason: 'http_error', httpStatus: 500 } });
  const run = await runFullFetch({ cssLinks: [], jsScripts: jsLinks, cache, fetchFn: fn });
  const resources = toFullResources(run.candidates, cache, 'JS');
  assert.deepEqual(resources.map((r) => [r.label.replace(`${ORIGIN}/`, ''), r.status, r.source || null]), [
    ['s1.js', 'ok', 'base'], ['s2.js', 'ok', 'extra'], ['s3.js', 'failed', null],
  ]);
  assert.equal(resources[2].httpStatus, 500);
  assert.equal(typeof resources[1].rawText, 'string');
  assert.equal(resources[2].rawText, undefined);
});
