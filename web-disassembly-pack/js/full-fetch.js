/**
 * 全文つき版の追加取得（v0.4.1）。
 *
 * 通常解析（「構造を見る」）は CSS・JS を各 MAX_CSS_FILES / MAX_JS_FILES 件まで取得する。
 * 全文つき版では、「全文つきでMarkdownを作る」を押したときに、不足分だけを追加で取得する。
 * 通常解析の取得処理と結果（state.cssResources / state.jsResources）には触れない。
 *
 * 取得件数の数え方（1回の全文生成ごと）:
 *   使用枠 = すでに取得に成功して再利用するファイル数 + 今回の通信試行の数（失敗・タイムアウトも1件）
 *   使用枠が FULL_MAX_CSS_FILES / FULL_MAX_JS_FILES に達したら、残りは試行しない。
 * 取得に成功したファイルはURLごとに保存して再利用し、二度と通信しない。
 * 失敗・タイムアウト・時間切れで未試行のものは成功扱いにせず、次回の全文生成で再試行する。
 *
 * DOMに依存しないため、Nodeのテストから直接呼べる（通信関数と時計は引数で差し替えられる）。
 */
import { truncateForAnalysis } from './coverage.js';
import {
  FULL_MAX_CSS_FILES,
  FULL_MAX_JS_FILES,
  FULL_FETCH_PER_REQUEST_MS,
  FULL_FETCH_TOTAL_MS,
  FULL_EXTRA_MAX_CHARS,
} from './constants.js';

export const DEFAULT_FULL_FETCH_LIMITS = Object.freeze({
  css: FULL_MAX_CSS_FILES,
  js: FULL_MAX_JS_FILES,
  perRequestMs: FULL_FETCH_PER_REQUEST_MS,
  totalMs: FULL_FETCH_TOTAL_MS,
  extraChars: FULL_EXTRA_MAX_CHARS,
});

// 次回の全文生成で再試行する状態
export const RETRYABLE_STATUSES = new Set(['failed', 'timeout', 'skipped_time']);

/**
 * 取得成功分の保存場所を作る。通常解析で取得に成功したファイルを、URLごとに入れておく。
 *
 * @param {Array} baseCss state.cssResources
 * @param {Array} baseJs state.jsResources
 * @returns {Map<string, object>} URL → { label, status: 'ok', type, source: 'base' | 'extra', size, analyzedChars, truncated, rawText, ... }
 */
export function createFullFetchCache(baseCss, baseJs) {
  const cache = new Map();
  for (const [type, entries] of [['CSS', baseCss], ['JS', baseJs]]) {
    for (const entry of entries || []) {
      if (entry.status !== 'ok' || cache.has(entry.label)) continue;
      cache.set(entry.label, { ...entry, type, source: 'base', truncatedBy: entry.truncated ? 'per_file' : null });
    }
  }
  return cache;
}

/** 追加取得した解析範囲の合計文字数 */
export function extraCharsOf(cache) {
  let total = 0;
  for (const entry of cache.values()) {
    if (entry.source === 'extra') total += entry.analyzedChars;
  }
  return total;
}

/** HTML内の参照（重複あり）を、URLごとの候補（HTMLで最初に出てきた順）にまとめる */
function candidatesOf(type, links) {
  const byUrl = new Map();
  const list = [];
  for (const link of links || []) {
    const found = byUrl.get(link.url);
    if (found) {
      found.references += 1;
      continue;
    }
    const candidate = { type, url: link.url, sameOrigin: Boolean(link.sameOrigin), references: 1, htmlOrder: list.length + 1 };
    byUrl.set(link.url, candidate);
    list.push(candidate);
  }
  return list;
}

/**
 * 今回の全文生成で、どのファイルを再利用・試行・未試行にするかを決める（通信はしない）。
 *
 * @returns {{ candidates: Array, attempts: number, extraChars: number }}
 *   candidates[].action: 'reuse' | 'attempt' | 'skipped_external' | 'skipped_full_limit' | 'skipped_budget'
 */
export function planFullFetch({ cssLinks, jsScripts, cache, limits = DEFAULT_FULL_FETCH_LIMITS }) {
  const extraChars = extraCharsOf(cache);
  const budgetExhausted = extraChars >= limits.extraChars;
  const candidates = [];

  for (const [type, links, limit] of [['CSS', cssLinks, limits.css], ['JS', jsScripts, limits.js]]) {
    const list = candidatesOf(type, links);
    // 再利用する成功分は、HTML内の位置にかかわらず先に枠を使う（すでに手元にあるため）
    let used = list.filter((c) => c.sameOrigin && cache.has(c.url)).length;
    for (const candidate of list) {
      if (!candidate.sameOrigin) {
        candidate.action = 'skipped_external';
      } else if (cache.has(candidate.url)) {
        candidate.action = 'reuse';
      } else if (used < limit) {
        candidate.action = budgetExhausted ? 'skipped_budget' : 'attempt';
        if (!budgetExhausted) used += 1;
      } else {
        candidate.action = 'skipped_full_limit';
      }
    }
    candidates.push(...list);
  }

  return { candidates, attempts: candidates.filter((c) => c.action === 'attempt').length, extraChars };
}

/**
 * 通信が要らない場合（試行が0件）の結果を作る。
 */
export function resolveWithoutFetch(plan, cache) {
  for (const candidate of plan.candidates) applyPlannedStatus(candidate, cache);
  return buildRunResult(plan.candidates, cache, [], { startedAt: 0, finishedAt: 0, stoppedBy: null, fetched: false });
}

function applyPlannedStatus(candidate, cache) {
  if (candidate.action === 'reuse') {
    candidate.status = 'ok';
    candidate.source = cache.get(candidate.url).source;
  } else {
    candidate.status = candidate.action;
  }
}

/**
 * 計画どおりに1件ずつ取得する。
 *
 * - 全体で limits.totalMs まで。各通信の待ち時間は min(limits.perRequestMs, 全体の残り時間)
 * - 追加取得の解析範囲の合計が limits.extraChars に達したら、残りは試行しない
 *   （達した通信の分は、残りの文字数まで解析範囲を切り詰めて保存する）
 * - isCancelled() が true になったら（やり直し・再解析）、結果を返さずに打ち切る
 *
 * @param {object} input
 * @param {(url: string, options: { timeoutMs: number }) => Promise<object>} input.fetchFn
 * @param {() => number} [input.now]
 * @param {() => boolean} [input.isCancelled]
 * @param {(progress: { done: number, total: number, url: string, type: string }) => void} [input.onProgress]
 */
export async function runFullFetch({
  cssLinks, jsScripts, cache, fetchFn, limits = DEFAULT_FULL_FETCH_LIMITS,
  now = Date.now, isCancelled = () => false, onProgress = () => {},
}) {
  const plan = planFullFetch({ cssLinks, jsScripts, cache, limits });
  const startedAt = now();
  const log = [];
  let extraChars = plan.extraChars;
  let stoppedBy = null;
  let done = 0;

  for (const candidate of plan.candidates) {
    if (candidate.action !== 'attempt') {
      applyPlannedStatus(candidate, cache);
      continue;
    }
    if (stoppedBy) {
      candidate.status = stoppedBy === 'time' ? 'skipped_time' : 'skipped_budget';
      continue;
    }
    if (isCancelled()) return { cancelled: true };

    const remaining = limits.totalMs - (now() - startedAt);
    if (remaining <= 0) {
      stoppedBy = 'time';
      candidate.status = 'skipped_time';
      continue;
    }
    if (extraChars >= limits.extraChars) {
      stoppedBy = 'budget';
      candidate.status = 'skipped_budget';
      continue;
    }

    onProgress({ done, total: plan.attempts, url: candidate.url, type: candidate.type });
    const timeoutMs = Math.min(limits.perRequestMs, remaining);
    const requestedAt = now();
    let result;
    try {
      result = await fetchFn(candidate.url, { timeoutMs });
    } catch {
      result = { ok: false, reason: 'network' };
    }
    if (isCancelled()) return { cancelled: true };
    done += 1;
    const record = { order: done, type: candidate.type, url: candidate.url, timeoutMs, elapsedMs: Math.max(0, now() - requestedAt) };

    if (!result || result.ok !== true || typeof result.content !== 'string') {
      candidate.status = result && result.reason === 'timeout' ? 'timeout' : 'failed';
      candidate.reason = (result && result.reason) || 'network';
      if (result && result.httpStatus) candidate.httpStatus = result.httpStatus;
      candidate.timeoutMs = timeoutMs;
      log.push({ ...record, outcome: candidate.status, reason: candidate.reason, httpStatus: candidate.httpStatus });
      continue;
    }

    const analysis = truncateForAnalysis(result.content);
    const room = limits.extraChars - extraChars;
    const entry = { label: candidate.url, status: 'ok', type: candidate.type, source: 'extra', ...analysis, truncatedBy: analysis.truncated ? 'per_file' : null };
    if (entry.analyzedChars > room) {
      entry.rawText = entry.rawText.slice(0, room);
      entry.analyzedChars = entry.rawText.length;
      entry.truncated = true;
      entry.truncatedBy = 'extra_budget';
    }
    extraChars += entry.analyzedChars;
    cache.set(candidate.url, entry);
    candidate.status = 'ok';
    candidate.source = 'extra';
    log.push({ ...record, outcome: 'ok', analyzedChars: entry.analyzedChars, truncatedBy: entry.truncatedBy });
  }

  onProgress({ done, total: plan.attempts, url: null, type: null });
  return buildRunResult(plan.candidates, cache, log, { startedAt, finishedAt: now(), stoppedBy, fetched: true });
}

function buildRunResult(candidates, cache, log, { startedAt, finishedAt, stoppedBy, fetched }) {
  const count = (status) => candidates.filter((c) => c.status === status).length;
  return {
    cancelled: false,
    fetched,
    candidates,
    log,
    stats: {
      attempts: log.length,
      okThisRun: log.filter((r) => r.outcome === 'ok').length,
      failed: count('failed'),
      timeout: count('timeout'),
      reused: candidates.filter((c) => c.action === 'reuse').length,
      skippedTime: count('skipped_time'),
      skippedBudget: count('skipped_budget'),
      skippedLimit: count('skipped_full_limit'),
      elapsedMs: Math.max(0, finishedAt - startedAt),
      extraChars: extraCharsOf(cache),
      stoppedBy,
    },
    retryable: candidates.some((c) => RETRYABLE_STATUSES.has(c.status)),
  };
}

/**
 * 全文Markdown用に、候補をHTMLの順の取得記録（buildFullMarkdown に渡す形）にする。
 * 成功分は保存した本文つき、それ以外は状態と理由だけ。
 */
export function toFullResources(candidates, cache, type) {
  return candidates
    .filter((c) => c.type === type)
    .map((c) => {
      const base = { label: c.url, references: c.references, htmlOrder: c.htmlOrder };
      if (c.status === 'ok') return { ...cache.get(c.url), ...base, status: 'ok' };
      return { ...base, status: c.status, reason: c.reason, httpStatus: c.httpStatus, timeoutMs: c.timeoutMs };
    });
}
