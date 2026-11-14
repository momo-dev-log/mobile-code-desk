/**
 * 「全文つきMarkdown」用の収録処理（v0.4.0 / PR-B）。
 *
 * 通常版Markdown（markdown.js の buildMarkdown）は変更せず、利用者が
 * 「全文つきでMarkdownを作る」を選んだときだけ、ここで作る節を後ろに追加する。
 *
 * 収録するもの:
 * - HTML構造枠: 元HTMLから script/style の本文だけを取り除いたもの（最大 MAX_FULL_HTML_CHARS 文字）
 * - CSS/JS本文: 取得・解析済みのソース（インライン / 同一オリジン外部）を合計 MAX_FULL_CODE_CHARS 文字まで
 *
 * 安全のための方針:
 * - 収録内容はすべてコードフェンスの中に入れ、実行も解釈もしない
 * - フェンスは本文中の最長のバッククォート連続より長くし、本文でフェンスが閉じないようにする
 * - 危険情報チェックと同じパターンに当てはまる文字列と、トークンらしき属性値はマスクする
 *   （パターン照合なので、すべての機密情報を見つけられるわけではない）
 * - 文字の向きを変える制御文字・NUL などは見える表記に置き換える
 *
 * DOMに依存しないため、Nodeのテストから直接呼べる。
 */
import { maskSensitive } from './danger-check.js';
import {
  MAX_FULL_HTML_CHARS,
  MAX_FULL_CODE_CHARS,
  FULL_CODE_CSS_SHARE,
  MIN_PARTIAL_CHARS,
} from './constants.js';

export const MASK_MARKER = '[WDP:マスク済み]';

// -----------------------------------------------
// 共通: 文字の正規化・コードフェンス
// -----------------------------------------------

// 文字の向きを変える制御文字（Trojan Source 対策）・NUL・その他の見えない制御文字
// eslint-disable-next-line no-control-regex
const INVISIBLE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩‎‏؜]/g;

/**
 * 改行を \n にそろえ、見えない制御文字を「[U+XXXX]」の表記に置き換える。
 *
 * @param {string} text
 * @returns {{ text: string, replacedControls: number }}
 */
export function sanitizeCodeText(text) {
  let replacedControls = 0;
  const normalized = (text || '').replace(/\r\n?/g, '\n').replace(INVISIBLE_CONTROL_RE, (ch) => {
    replacedControls += 1;
    return `[U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`;
  });
  return { text: normalized, replacedControls };
}

/**
 * 本文を、本文の中では閉じないコードフェンスで囲む。
 * フェンスの長さは「本文中の最長のバッククォート連続 + 1」（最低3）。
 *
 * @param {string} text
 * @param {string} [lang]
 * @returns {string}
 */
export function fenceCode(text, lang = '') {
  const body = text || '';
  const runs = body.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const content = body.endsWith('\n') ? body.slice(0, -1) : body;
  return `${fence}${lang}\n${content}\n${fence}`;
}

/**
 * Markdownの本文中（フェンスの外）に出す識別子（URLなど）を、インラインコードにする。
 * 改行は空白にし、本文中のバッククォートより長い区切りを使う。
 */
export function inlineCode(text) {
  const body = String(text || '').replace(/[\r\n]+/g, ' ');
  const runs = body.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const tick = '`'.repeat(longest + 1);
  const pad = body.startsWith('`') || body.endsWith('`') ? ' ' : '';
  return `${tick}${pad}${body}${pad}${tick}`;
}

// -----------------------------------------------
// HTML構造枠
// -----------------------------------------------

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/**
 * HTMLを、タグ・テキスト・コメント・script/styleの本文に分ける簡易的な分解器。
 * 属性値の中の「>」で途中切れしないよう、引用符を考慮してタグの終わりを探す。
 */
export function tokenizeHtml(html) {
  const src = html || '';
  const tokens = [];
  const n = src.length;
  let i = 0;

  const pushText = (text) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === 'text') last.raw += text;
    else tokens.push({ type: 'text', raw: text });
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(src.slice(i));
      break;
    }
    pushText(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      tokens.push({ type: 'comment', raw: src.slice(lt, end) });
      i = end;
      continue;
    }

    const next = src[lt + 1] || '';
    if (next === '!' || next === '?') {
      const close = src.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      tokens.push({ type: 'decl', raw: src.slice(lt, end) });
      i = end;
      continue;
    }

    const closing = next === '/';
    const nameStart = closing ? lt + 2 : lt + 1;
    if (!/[A-Za-z]/.test(src[nameStart] || '')) {
      pushText('<');
      i = lt + 1;
      continue;
    }

    const end = scanTagEnd(src, nameStart);
    const raw = src.slice(lt, end);
    const name = (raw.slice(closing ? 2 : 1).match(/^[^\s/>]+/) || [''])[0].toLowerCase();
    tokens.push({ type: closing ? 'close' : 'open', name, raw });
    i = end;

    if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
      const closeRe = new RegExp(`</${name}[\\s/>]`, 'ig');
      closeRe.lastIndex = i;
      const found = closeRe.exec(src);
      const bodyEnd = found ? found.index : n;
      tokens.push({ type: 'rawtext', name, raw: src.slice(i, bodyEnd) });
      i = bodyEnd;
    }
  }

  return tokens;
}

function scanTagEnd(src, from) {
  let quote = null;
  let afterEquals = false;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && afterEquals) {
      quote = ch;
      afterEquals = false;
      continue;
    }
    if (ch === '>') return i + 1;
    if (ch === '=') afterEquals = true;
    else if (!/\s/.test(ch)) afterEquals = false;
  }
  return src.length;
}

/**
 * 開始タグの属性を読み取る。読み取れない形のときは null を返す（そのタグは元のまま使う）。
 */
function parseAttributes(raw) {
  const inner = raw.replace(/^<[^\s/>]+/, '').replace(/\/?>$/, '');
  const attrs = [];
  const re = /\s*([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?|\s*\/|\s+/gy;
  let pos = 0;
  while (pos < inner.length) {
    re.lastIndex = pos;
    const m = re.exec(inner);
    if (!m || m[0].length === 0) return null;
    pos = re.lastIndex;
    if (m[1] === undefined) continue;
    const value = m[2] ?? m[3] ?? m[4];
    attrs.push({ name: m[1], value });
  }
  return attrs;
}

function attrValue(attrs, name) {
  const found = attrs.find((a) => a.name.toLowerCase() === name);
  return found ? found.value : undefined;
}

function serializeTag(raw, attrs) {
  const name = (raw.match(/^<([^\s/>]+)/) || ['', ''])[1];
  const selfClosing = /\/>$/.test(raw);
  const parts = attrs.map(({ name: attrName, value }) => (
    value === undefined ? attrName : `${attrName}="${value.replace(/"/g, '&quot;')}"`
  ));
  return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}${selfClosing ? ' /' : ''}>`;
}

// トークン・認証情報らしい属性の名前（属性名そのもの、または name/id/property の値）
const SENSITIVE_ATTR_NAME_RE = /(csrf|xsrf|token|nonce|secret|passw(?:or)?d|api[-_]?key|access[-_]?key|auth[-_]?(?:key|token)|session[-_]?id|credential)/i;

function maskSensitiveAttributes(attrs, tagName) {
  let masked = 0;
  const owner = [attrValue(attrs, 'name'), attrValue(attrs, 'id'), attrValue(attrs, 'property'), attrValue(attrs, 'http-equiv')]
    .filter(Boolean)
    .join(' ');
  const ownerSensitive = SENSITIVE_ATTR_NAME_RE.test(owner);
  const isPassword = tagName === 'input' && (attrValue(attrs, 'type') || '').toLowerCase() === 'password';

  const result = attrs.map((attr) => {
    if (attr.value === undefined || attr.value === '' || attr.value === MASK_MARKER) return attr;
    const lower = attr.name.toLowerCase();
    const selfSensitive = SENSITIVE_ATTR_NAME_RE.test(lower);
    const valueCarrier = lower === 'value' || lower === 'content';
    if (selfSensitive || (valueCarrier && (ownerSensitive || isPassword))) {
      masked += 1;
      return { name: attr.name, value: MASK_MARKER };
    }
    return attr;
  });

  return { attrs: result, masked };
}

const ATTR_SHORTEN_OVER = 200;
const ATTR_KEEP = 100;
const TEXT_SHORTEN_OVER = 200;
const TEXT_KEEP = 150;
const COMMENT_SHORTEN_OVER = 120;
const COMMENT_KEEP = 80;

const omitNote = (count) => `…[WDP:${count}文字省略]`;

/**
 * HTML構造枠を作る。
 *
 * 段階的に縮める:
 * 0. 常に: script/style の本文を取り除き、識別子つきの置き換え文に変える。
 *    残りの部分の危険情報パターン・トークンらしき属性値をマスクする。
 * 1. 上限を超える場合: 空白の連続をまとめ、長いテキスト・属性値（data: URIなど）・コメントを短くする。
 *    タグと要素の入れ子はそのまま残す。
 * 2. それでも超える場合: タグの境目で「先頭」と「末尾」を残し、中間を省略する（省略した文字数を明記）。
 *
 * @param {string} html 元のHTML
 * @param {number} [limit]
 * @returns {{
 *   text: string, originalChars: number, includedChars: number, truncated: boolean,
 *   compacted: boolean, omittedChars: number, removedScriptBodies: number, removedStyleBodies: number,
 *   maskedCount: number, replacedControls: number,
 *   shortened: { text: number, attribute: number, comment: number },
 * }}
 */
export function buildHtmlSkeleton(html, limit = MAX_FULL_HTML_CHARS) {
  const original = html || '';
  const sanitized = sanitizeCodeText(original);
  const tokens = tokenizeHtml(sanitized.text);

  const stats = {
    originalChars: original.length,
    removedScriptBodies: 0,
    removedStyleBodies: 0,
    maskedCount: 0,
    replacedControls: sanitized.replacedControls,
    shortened: { text: 0, attribute: 0, comment: 0 },
  };

  // 段階0: script/style本文の除去・属性のマスク
  let inlineScriptNo = 0;
  let inlineStyleNo = 0;
  let templateDepth = 0;
  let lastOpen = null;

  for (const token of tokens) {
    // script/style本文は下で置き換えるため、それ以外のトークンだけをマスクする
    if (token.type !== 'rawtext') {
      const masked = maskSensitive(token.raw);
      token.raw = masked.text;
      stats.maskedCount += masked.count;
    }

    if (token.type === 'open') {
      token.attrs = parseAttributes(token.raw);
      if (token.attrs) {
        const { attrs, masked } = maskSensitiveAttributes(token.attrs, token.name);
        if (masked > 0) {
          token.attrs = attrs;
          token.raw = serializeTag(token.raw, attrs);
          stats.maskedCount += masked;
        }
      }
      if (token.name === 'template') templateDepth += 1;
      lastOpen = token;
    } else if (token.type === 'close') {
      if (token.name === 'template' && templateDepth > 0) templateDepth -= 1;
    } else if (token.type === 'rawtext') {
      token.raw = replaceRawText(token, lastOpen, templateDepth > 0, stats, {
        nextScript: () => (inlineScriptNo += 1),
        nextStyle: () => (inlineStyleNo += 1),
      });
    }
  }

  const serialize = () => tokens.map((t) => t.raw).join('');
  let text = serialize();
  let compacted = false;

  // 段階1: 長い部分を短くする（構造は残す）
  if (text.length > limit) {
    compacted = true;
    compactTokens(tokens, stats);
    text = serialize();
  }

  // 段階2: 先頭と末尾を残して中間を省略する
  let truncated = false;
  let omittedChars = 0;
  if (text.length > limit) {
    truncated = true;
    const result = cutHeadAndTail(tokens, limit);
    text = result.text;
    omittedChars = result.omittedChars;
  }

  return {
    text,
    includedChars: text.length,
    truncated,
    compacted,
    omittedChars,
    ...stats,
  };
}

function replaceRawText(token, openToken, inTemplate, stats, counters) {
  const body = token.raw;
  if (body.trim() === '') return body;

  if (token.name === 'style') {
    stats.removedStyleBodies += 1;
    if (inTemplate) return `/* [WDP] template内のstyle本文 ${body.length}文字は省略（本文は収録対象外） */`;
    const no = counters.nextStyle();
    return `/* [WDP] 本文省略: インラインstyle #${no}（${body.length}文字）。本文は「CSS本文」を参照 */`;
  }

  stats.removedScriptBodies += 1;
  const src = openToken && openToken.attrs ? attrValue(openToken.attrs, 'src') : undefined;
  if (src) return `/* [WDP] src指定scriptの中の本文 ${body.length}文字は省略（ブラウザは実行しない部分） */`;
  if (inTemplate) return `/* [WDP] template内のscript本文 ${body.length}文字は省略（本文は収録対象外） */`;
  const no = counters.nextScript();
  return `/* [WDP] 本文省略: インラインscript #${no}（${body.length}文字）。本文は「JavaScript本文」を参照 */`;
}

function compactTokens(tokens, stats) {
  for (const token of tokens) {
    if (token.type === 'text') {
      let text = token.raw.replace(/[ \t\f]*\n\s*/g, '\n').replace(/[ \t\f]{2,}/g, ' ');
      if (text.length > TEXT_SHORTEN_OVER) {
        text = text.slice(0, TEXT_KEEP) + omitNote(text.length - TEXT_KEEP);
        stats.shortened.text += 1;
      }
      token.raw = text;
    } else if (token.type === 'comment') {
      if (token.raw.length > COMMENT_SHORTEN_OVER) {
        const omitted = token.raw.length - COMMENT_KEEP;
        token.raw = `${token.raw.slice(0, COMMENT_KEEP).replace(/-+$/, '')}${omitNote(omitted)} -->`;
        stats.shortened.comment += 1;
      }
    } else if (token.type === 'open' && token.attrs) {
      let changed = false;
      const attrs = token.attrs.map((attr) => {
        if (attr.value === undefined || attr.value.length <= ATTR_SHORTEN_OVER) return attr;
        changed = true;
        stats.shortened.attribute += 1;
        return { name: attr.name, value: attr.value.slice(0, ATTR_KEEP) + omitNote(attr.value.length - ATTR_KEEP) };
      });
      if (changed) {
        token.attrs = attrs;
        token.raw = serializeTag(token.raw, attrs);
      }
    }
  }
}

const HEAD_SHARE = 0.8;
const CUT_MARKER_RESERVE = 120;

function cutHeadAndTail(tokens, limit) {
  const budget = Math.max(0, limit - CUT_MARKER_RESERVE);
  const headBudget = Math.floor(budget * HEAD_SHARE);
  const tailBudget = budget - headBudget;

  let headLen = 0;
  let headEnd = 0;
  while (headEnd < tokens.length && headLen + tokens[headEnd].raw.length <= headBudget) {
    headLen += tokens[headEnd].raw.length;
    headEnd += 1;
  }

  let tailLen = 0;
  let tailStart = tokens.length;
  while (tailStart > headEnd && tailLen + tokens[tailStart - 1].raw.length <= tailBudget) {
    tailLen += tokens[tailStart - 1].raw.length;
    tailStart -= 1;
  }

  const omitted = tokens.slice(headEnd, tailStart);
  const omittedChars = omitted.reduce((sum, t) => sum + t.raw.length, 0);
  const omittedTags = omitted.filter((t) => t.type === 'open').length;
  const marker = `\n<!-- [WDP] ここから ${omittedChars}文字（開始タグ ${omittedTags}個を含む）を文字数上限のため省略 -->\n`;

  const head = tokens.slice(0, headEnd).map((t) => t.raw).join('');
  const tail = tokens.slice(tailStart).map((t) => t.raw).join('');
  return { text: head + marker + tail, omittedChars };
}

// -----------------------------------------------
// CSS/JS本文
// -----------------------------------------------

/**
 * CSS/JS本文の収録計画を作る。
 *
 * - 対象: インラインstyle/script（全件）と、取得に成功した同一オリジンの外部CSS/JS
 *   （本文は解析範囲 = 1ファイル MAX_RESOURCE_CHARS 文字までの rawText）
 * - 同じ本文（完全一致）が複数あるときは、最初の1件だけを収録し、残りは「同一内容」と記録する
 * - 合計 MAX_FULL_CODE_CHARS 文字を、CSSに FULL_CODE_CSS_SHARE、JSに残りを割り当てる。
 *   片方が割り当てを使い切らない場合、余りはもう片方が使える
 * - 種類ごとに、文字数の小さいソースから順に全文を収録する。入りきらない最初のソースだけは
 *   残りの枠で途中まで収録し（残りが MIN_PARTIAL_CHARS 未満なら収録しない）、以降は収録しない
 * - 文字数はマスク・制御文字の置き換え後の本文で数える
 *
 * @param {object} input
 * @param {Array} input.inlineStyles
 * @param {Array} input.inlineScripts
 * @param {Array} input.cssResources
 * @param {Array} input.jsResources
 * @param {number} [limit]
 */
export function planCodeInclusion({ inlineStyles, inlineScripts, cssResources, jsResources }, limit = MAX_FULL_CODE_CHARS) {
  const css = collectSources('CSS', inlineStyles, cssResources);
  const js = collectSources('JS', inlineScripts, jsResources);

  const need = (list) => list.filter((s) => !s.duplicateOf).reduce((sum, s) => sum + s.text.length, 0);
  const cssNeed = need(css);
  const jsNeed = need(js);
  const cssShare = Math.floor(limit * FULL_CODE_CSS_SHARE);
  const cssBudget = Math.min(cssNeed, Math.max(cssShare, limit - jsNeed));
  const jsBudget = Math.min(jsNeed, limit - cssBudget);

  allocate(css, cssBudget);
  allocate(js, jsBudget);

  const used = (list) => list.reduce((sum, s) => sum + s.includedChars, 0);
  return {
    css,
    js,
    limit,
    cssBudget,
    jsBudget,
    usedChars: used(css) + used(js),
  };
}

function collectSources(type, inlineEntries, resourceEntries) {
  const list = [];
  (inlineEntries || []).forEach((entry, i) => {
    list.push(makeSource(type, 'inline', entry, entry.label || `インライン${type === 'CSS' ? 'style' : 'script'} #${i + 1}`));
  });
  (resourceEntries || []).filter((entry) => entry.status === 'ok').forEach((entry) => {
    list.push(makeSource(type, 'external', entry, entry.label));
  });

  const seen = new Map();
  for (const source of list) {
    if (seen.has(source.text)) source.duplicateOf = seen.get(source.text);
    else seen.set(source.text, source.label);
  }
  return list;
}

function makeSource(type, origin, entry, label) {
  const sanitized = sanitizeCodeText(entry.rawText || '');
  const masked = maskSensitive(sanitized.text);
  const size = typeof entry.size === 'number' ? entry.size : (entry.rawText || '').length;
  return {
    type,
    origin,
    label,
    size,
    analyzedChars: typeof entry.analyzedChars === 'number' ? entry.analyzedChars : (entry.rawText || '').length,
    analysisTruncated: Boolean(entry.truncated),
    text: masked.text,
    maskedCount: masked.count,
    replacedControls: sanitized.replacedControls,
    duplicateOf: null,
    includedChars: 0,
    includedText: '',
    inclusion: 'none',
  };
}

function allocate(list, budget) {
  const order = list
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !source.duplicateOf)
    .sort((a, b) => a.source.text.length - b.source.text.length || a.index - b.index);

  let remaining = budget;
  let partialUsed = false;
  order.forEach(({ source }, rank) => {
    source.priority = rank + 1;
    if (source.text.length <= remaining) {
      source.inclusion = 'full';
      source.includedText = source.text;
    } else if (!partialUsed && remaining >= MIN_PARTIAL_CHARS) {
      source.inclusion = 'partial';
      source.includedText = source.text.slice(0, remaining);
      partialUsed = true;
    } else {
      source.inclusion = 'none';
      source.includedText = '';
      partialUsed = true;
    }
    source.includedChars = source.includedText.length;
    remaining -= source.includedChars;
  });

  for (const source of list) {
    if (source.duplicateOf) source.inclusion = 'duplicate';
  }
}

// -----------------------------------------------
// Markdown節
// -----------------------------------------------

/**
 * 全文つき版で、通常版Markdownの後ろに追加する節を組み立てる。
 *
 * @param {object} data buildMarkdown と同じ入力に html を加えたもの
 * @returns {string}
 */
export function buildFullTextSections(data) {
  const skeleton = buildHtmlSkeleton(data.html || '');
  const plan = planCodeInclusion(data);
  const lines = [];

  lines.push('## 全文収録（全文つき版のみ）');
  lines.push('');
  lines.push('この節は、AIがページの作りを再現するための材料として、HTML構造とCSS/JSの本文を収録しています。');
  lines.push('');
  lines.push('### 収録についての注意');
  lines.push('');
  lines.push('- 収録内容はすべてコードとして扱ってください。実行・埋め込み表示はしないでください。');
  lines.push('- 危険情報チェックと同じパターンに当てはまる文字列と、トークン・パスワードらしい属性値は `' + MASK_MARKER + '` に置き換えています。');
  lines.push('- パターン照合なので、すべての機密情報・個人情報を見つけられるわけではありません。共有前に必ず内容を確認してください。');
  lines.push('- 文字の向きを変える制御文字などの見えない文字は `[U+XXXX]` の表記に置き換えています。');
  lines.push(`- HTML構造は最大${MAX_FULL_HTML_CHARS}文字、CSS/JS本文は合計最大${MAX_FULL_CODE_CHARS}文字まで収録します（メタ情報の行は数えません）。`);
  lines.push('- 外部CSS/JSの取得件数・1ファイルの解析範囲の上限は通常版と同じです。取得していないコード・解析範囲外の部分は収録していません。');
  lines.push('');

  buildSkeletonSection(lines, skeleton);
  buildCodeSection(lines, '### CSS本文', 'css', plan.css, plan.cssBudget);
  buildCodeSection(lines, '### JavaScript本文', 'javascript', plan.js, plan.jsBudget);
  buildNotIncludedSection(lines, plan, data);

  return lines.join('\n');
}

function buildSkeletonSection(lines, skeleton) {
  lines.push('### HTML構造（script/style本文を除く）');
  lines.push('');
  lines.push(`- 元のHTML: ${skeleton.originalChars}文字`);
  lines.push(`- 収録: ${skeleton.includedChars}文字（上限${MAX_FULL_HTML_CHARS}文字）`);
  lines.push(`- script本文の除去: ${skeleton.removedScriptBodies}件 / style本文の除去: ${skeleton.removedStyleBodies}件（本文は下の「CSS本文」「JavaScript本文」に収録）`);
  if (skeleton.compacted) {
    const { text, attribute, comment } = skeleton.shortened;
    lines.push(`- 短縮: 上限を超えたため、空白をまとめ、長いテキスト${text}件・属性値${attribute}件・コメント${comment}件を短くしました（タグの入れ子は保っています）。`);
  } else {
    lines.push('- 短縮: なし（タグ・テキスト・属性値は元のまま）');
  }
  if (skeleton.truncated) {
    lines.push(`- 切り詰め: あり。先頭と末尾を残し、中間の${skeleton.omittedChars}文字（短縮後の文字数）を省略しました（省略位置に \`[WDP]\` のコメントがあります）。`);
  } else {
    lines.push('- 切り詰め: なし');
  }
  if (skeleton.maskedCount > 0) lines.push(`- マスク: ${skeleton.maskedCount}件`);
  if (skeleton.replacedControls > 0) lines.push(`- 制御文字の置き換え: ${skeleton.replacedControls}件`);
  lines.push('');
  lines.push(fenceCode(skeleton.text, 'html'));
  lines.push('');
}

const ORIGIN_LABEL = { inline: 'インライン', external: '外部（同一オリジン）' };

function buildCodeSection(lines, heading, lang, sources, budget) {
  lines.push(heading);
  lines.push('');
  lines.push(`- この種類に割り当てた枠: ${budget}文字`);
  lines.push('- 並び: インライン（HTML内の出現順）→ 外部（HTML内の参照順）。収録は文字数の小さいものから優先しています。');
  lines.push('');

  if (sources.length === 0) {
    lines.push('（収録できる本文はありません）');
    lines.push('');
    return;
  }

  for (const source of sources) {
    lines.push(`#### [${source.type}・${ORIGIN_LABEL[source.origin]}] ${inlineCode(source.label)}`);
    lines.push('');
    lines.push(`- 元の文字数: ${source.size}文字`);
    lines.push(source.analysisTruncated
      ? `- 解析範囲: ${source.analyzedChars}文字（1ファイルの解析上限で切り詰め。${source.analyzedChars + 1}文字目以降は未取得扱い）`
      : `- 解析範囲: ${source.analyzedChars}文字（全文）`);

    if (source.inclusion === 'duplicate') {
      lines.push(`- 収録: なし（${inlineCode(source.duplicateOf)} と同一内容のため本文を省略）`);
      lines.push('');
      continue;
    }

    lines.push(`- 収録優先順: ${source.priority}`);
    if (source.inclusion === 'full') {
      lines.push(`- 収録: ${source.includedChars}文字（${source.analysisTruncated ? '解析範囲の全文。元ファイルの後半は未収録' : '全文'}）`);
    } else if (source.inclusion === 'partial') {
      lines.push(`- 収録: ${source.includedChars}文字（途中まで。文字数上限のため ${source.includedChars + 1}文字目以降は未収録）`);
    } else {
      lines.push('- 収録: なし（CSS/JS本文の文字数上限のため）');
    }
    if (source.maskedCount > 0) lines.push(`- マスク: ${source.maskedCount}件`);
    if (source.replacedControls > 0) lines.push(`- 制御文字の置き換え: ${source.replacedControls}件`);
    lines.push('');

    if (source.inclusion === 'none') continue;

    lines.push(fenceCode(source.includedText, lang));
    if (source.inclusion === 'partial') {
      lines.push('');
      lines.push(`**↑ このソースはここで途中終了しています（残り ${source.text.length - source.includedChars}文字は未収録）。**`);
    } else if (source.analysisTruncated) {
      lines.push('');
      lines.push(`**↑ 元ファイルは${source.size}文字あり、${source.analyzedChars + 1}文字目以降は解析範囲外のため未収録です。**`);
    }
    lines.push('');
  }
}

function buildNotIncludedSection(lines, plan, data) {
  lines.push('### 収録しなかったコード');
  lines.push('');

  const items = [];
  const describe = { failed: '取得失敗', skipped_external: '外部オリジンのため取得対象外', skipped_limit: '取得件数の上限を超えたため取得対象外' };
  for (const [type, entries] of [['CSS', data.cssResources], ['JS', data.jsResources]]) {
    for (const entry of entries || []) {
      if (entry.status === 'ok') continue;
      const reason = entry.status === 'failed' && entry.reason ? `（理由: ${entry.reason}）` : '';
      items.push(`- [${type}] ${inlineCode(entry.label)}: ${describe[entry.status] || '不明'}${reason}`);
    }
  }
  for (const source of [...plan.css, ...plan.js]) {
    if (source.inclusion === 'none') items.push(`- [${source.type}] ${inlineCode(source.label)}: 文字数上限のため本文を収録せず（${source.text.length}文字）`);
    if (source.inclusion === 'partial') items.push(`- [${source.type}] ${inlineCode(source.label)}: 文字数上限のため ${source.includedChars + 1}文字目以降を収録せず`);
    if (source.analysisTruncated) items.push(`- [${source.type}] ${inlineCode(source.label)}: 1ファイルの解析上限のため ${source.analyzedChars + 1}文字目以降は取得・収録せず`);
  }

  if (items.length === 0) {
    lines.push('（取得・収録できなかったCSS/JSはありません）');
  } else {
    lines.push(...items);
  }
  lines.push('- HTMLの `<script src>` と `<link rel="stylesheet">` 以外の方法で読み込まれるコードは追跡していないため、収録していません。');
  lines.push('');
}
