/**
 * パックのMarkdown生成。
 * docs/spec.md 11章「出力仕様」に準拠。
 *
 * - 正本: Markdown、パック全体で1ファイル
 * - 各記事の冒頭に元URLを必ず焼き込む
 * - 本文はプレーンテキストとしてそのまま埋め込む
 * - short_body警告はパック出力には記載しない
 */

/**
 * @param {string} packName
 * @param {Array<{
 *   title: string,
 *   originalUrl: string,
 *   domain: string,
 *   fetchedAt: string,
 *   charCount: number,
 *   body: string | null,
 * }>} articles パックの並び順（追加順）。bodyがnullの記事はスキップする。
 * @returns {{ markdown: string, skippedCount: number }}
 */
export function buildPackMarkdown(packName, articles) {
  const usable = articles.filter(a => a.body !== null && a.body !== undefined);
  const skippedCount = articles.length - usable.length;

  const now = new Date();
  const createdAt = formatDateTime(now);

  const lines = [];
  lines.push(`# ${packName}`);
  lines.push('');
  lines.push(`- 作成日時: ${createdAt}`);
  lines.push(`- 記事数: ${usable.length}件`);
  lines.push('');
  lines.push('## 目次');
  lines.push('');
  usable.forEach((article, i) => {
    lines.push(`${i + 1}. ${article.title}（${article.domain}）`);
  });
  lines.push('');

  usable.forEach((article, i) => {
    lines.push('---');
    lines.push('');
    lines.push(`## ${i + 1}. ${article.title}`);
    lines.push('');
    lines.push(`- 元URL: ${article.originalUrl}`);
    lines.push(`- ドメイン: ${article.domain}`);
    lines.push(`- 取得日時: ${formatDateTime(new Date(article.fetchedAt))}`);
    lines.push(`- 文字数: 約${formatCharCount(article.charCount)}字`);
    lines.push('');
    lines.push(article.body);
    lines.push('');
  });

  if (skippedCount > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`${skippedCount}件をスキップしました`);
  }

  return { markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', skippedCount };
}

/**
 * パック名と同内容のMarkdownから、記号を除いたプレーン構造のtxt版を生成する。
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToPlainText(markdown) {
  return markdown
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').replace(/^-\s*/, ''))
    .join('\n')
    .replace(/^---$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/**
 * ファイル名に使えない文字を `_` に置換する。
 * @param {string} name
 * @returns {string}
 */
export function sanitizePackName(name) {
  const sanitized = name
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return sanitized || '資料パック';
}

/**
 * `{パック名}_YYYYMMDD_HHmm.{ext}` 形式のファイル名を生成する。
 * @param {string} packName
 * @param {string} ext
 * @param {Date} [date]
 * @returns {string}
 */
export function generateFilename(packName, ext, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${sanitizePackName(packName)}_${yyyy}${mm}${dd}_${hh}${min}.${ext}`;
}

function formatDateTime(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatCharCount(charCount) {
  return charCount.toLocaleString('ja-JP');
}
