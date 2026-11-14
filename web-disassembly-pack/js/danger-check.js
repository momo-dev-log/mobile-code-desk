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
    // キー名は「前に語が付いた複合名」（access_token / client_secret / authToken / API_TOKEN など）も対象にする。
    // 先頭の否定の後読み: 英数字の長い連続の途中から照合を始め直さない（2乗の時間を防ぐ）。
    // 区切りは : か = に限る（「secret sauce」のような文章を拾わないため）。
    regex: /((?<![A-Za-z0-9_$-])["']?[A-Za-z0-9_$-]*(?:api[_-]?key|secret|token|access[_-]?key|auth)["']?)(\s*[:=]\s*["']?)([A-Za-z0-9_\-]{12,})/gi,
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
    // 先頭の否定の後読み: 英数字の長い連続（base64など）の途中から照合を始め直さない（2乗の時間を防ぐ）。
    // 一致は必ず連続の先頭から始まるため、見つかる文字列は後読みなしの場合と同じ。
    regex: /(?<![A-Za-z0-9._%+/@-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9/])/g,
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
 * @param {(passIndex: number, start: number, end: number, length: number) => void} [onReplace]
 *   置き換えのたびに呼ばれる（任意）。パターンごとの置き換えは順に行うため、start/end は
 *   そのパターンを適用する直前の文字列での位置、length は置き換え後の文字数。
 *   元の文字列の何文字目にあたるかを数え直すために使う。結果の文字列は渡さない場合と同じ。
 * @returns {{ text: string, count: number }}
 */
// マスク用の正規表現は読み込み時に1回だけ作る（全文つき版ではトークンごとに呼ばれるため）。
// replace() は global の正規表現の lastIndex を毎回0から使うので、使い回してよい。
const MASK_PATTERNS = PATTERNS.map(({ regex, maskRegex, keepPrefixGroups }) => ({
  regex: new RegExp((maskRegex || regex).source, (maskRegex || regex).flags),
  keepPrefixGroups,
}));

export function maskSensitive(text, onReplace) {
  let count = 0;
  let out = text || '';

  MASK_PATTERNS.forEach(({ regex, keepPrefixGroups }, passIndex) => {
    out = out.replace(regex, (...args) => {
      count += 1;
      const prefix = keepPrefixGroups ? args.slice(1, 1 + keepPrefixGroups).join('') : '';
      if (onReplace) {
        // 名前付きグループは使っていないため、一致位置は引数の後ろから2番目
        const offset = args[args.length - 2];
        onReplace(passIndex, offset + prefix.length, offset + args[0].length, MASK_TEXT.length);
      }
      return prefix + MASK_TEXT;
    });
  });

  return { text: out, count };
}
