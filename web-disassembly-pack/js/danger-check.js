/**
 * Markdown生成前に、取得した内容に機密情報らしき文字列が
 * 含まれていないかをチェックする。
 *
 * v0.1では検出のみ行い、該当箇所はマスクしてMarkdownに記録する。
 * 最終的に共有してよいかどうかの判断はユーザーに委ねる。
 */

const PATTERNS = [
  {
    type: 'APIキー/トークンらしき文字列',
    regex: /(api[_-]?key|secret|token|access[_-]?key|auth)(["'\s:=]+)([A-Za-z0-9_\-]{12,})/gi,
    // マスク時はキー名と区切りを残し、値だけを置き換える
    keepPrefixGroups: 2,
  },
  {
    type: 'AWSアクセスキーID',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    type: 'Bearerトークン',
    regex: /Bearer\s+[A-Za-z0-9._\-]{10,}/g,
  },
  {
    type: 'メールアドレス',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: '秘密鍵ブロック',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    // マスク時は見出し行だけでなく、鍵の本体（END行まで。無ければ末尾まで）を置き換える
    maskRegex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
];

const MAX_FINDINGS_PER_PATTERN = 3;

/**
 * @param {Array<{ label: string, text: string }>} sources チェック対象（取得元の名前と本文）
 * @returns {Array<{ label: string, type: string, preview: string }>}
 */
export function checkDangerousContent(sources) {
  const findings = [];

  for (const { label, text } of sources) {
    if (!text) continue;

    for (const { type, regex } of PATTERNS) {
      const matches = text.match(regex);
      if (!matches) continue;

      for (const match of matches.slice(0, MAX_FINDINGS_PER_PATTERN)) {
        findings.push({ label, type, preview: maskMatch(match) });
      }
    }
  }

  return findings;
}

function maskMatch(match) {
  if (match.length <= 8) return '*'.repeat(match.length);
  return `${match.slice(0, 4)}...${match.slice(-4)}`;
}

const MASK_TEXT = '[WDP:マスク済み]';

/**
 * 危険情報チェックと同じパターンに当てはまる文字列を「[WDP:マスク済み]」に置き換える。
 * 全文つきMarkdownで本文を収録する前に使う。
 *
 * パターン照合なので、すべての機密情報を見つけられるわけではない。
 *
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function maskSensitive(text) {
  let count = 0;
  let out = text || '';

  for (const { regex, maskRegex, keepPrefixGroups } of PATTERNS) {
    const pattern = maskRegex || regex;
    out = out.replace(new RegExp(pattern.source, pattern.flags), (...args) => {
      count += 1;
      const prefix = keepPrefixGroups ? args.slice(1, 1 + keepPrefixGroups).join('') : '';
      return prefix + MASK_TEXT;
    });
  }

  return { text: out, count };
}
