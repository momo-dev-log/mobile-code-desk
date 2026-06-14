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
    regex: /(api[_-]?key|secret|token|access[_-]?key|auth)["'\s:=]+[A-Za-z0-9_\-]{12,}/gi,
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
