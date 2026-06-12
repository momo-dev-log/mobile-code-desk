/**
 * 本文抽出（ブラウザ側）
 * v1/app.js の prepareDoc / nodeToPlainText / processForPack のロジックを
 * 移植したもの。IndexedDBには抽出後のプレーンテキストのみ保存するため、
 * ここで生成したテキストのみが保存対象になる。
 */

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

/**
 * 生HTMLから本文候補要素を抜き出す。
 * @param {string} rawHtml
 * @returns {{ doc: Document, mainEl: Element, usedSelector: string }}
 */
export function prepareDoc(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  [
    'script', 'style', 'noscript',
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[aria-hidden="true"]',
  ].forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

  const selectors = [
    'main', 'article', '[role="main"]',
    '#main', '#content',
    '.content', '.entry-content', '.post-body',
    '.post-content', '.article-body', '.hentry',
  ];

  let mainEl = null;
  let usedSelector = 'body（フォールバック）';

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) { mainEl = el; usedSelector = sel; break; }
  }
  if (!mainEl) mainEl = doc.body;

  return { doc, mainEl, usedSelector };
}

/**
 * DOMノードをプレーンテキストに変換する（ブロック要素は改行で区切る）。
 * @param {Node} node
 * @returns {string}
 */
export function nodeToPlainText(node) {
  if (!node) return '';
  const parts = [];

  function walk(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent.replace(/[\r\n\t ]+/g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') { parts.push('\n'); return; }
    if (tag === 'hr') { parts.push('\n\n'); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n');
    n.childNodes.forEach(walk);
    if (isBlock) parts.push('\n');
  }

  walk(node);
  return parts.join('')
    .replace(/[ \t]*\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 生HTMLから記事のタイトルと本文プレーンテキストを抽出する。
 * タイトル優先順位: 先頭H1 > doc.title > URL（v1/app.js processForPackと同じ）
 * @param {string} rawHtml
 * @param {string} sourceUrl
 * @returns {{ title: string, body: string, charCount: number }}
 */
export function extractArticle(rawHtml, sourceUrl) {
  const rawDoc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const docTitle = (rawDoc.title || '').trim();
  const rawH1 = rawDoc.body ? rawDoc.body.querySelector('h1') : null;
  const h1Text = rawH1 ? rawH1.textContent.trim() : '';
  const title = h1Text || docTitle || sourceUrl;

  const { mainEl } = prepareDoc(rawHtml);

  const contentH1 = mainEl.querySelector('h1');
  if (contentH1 && contentH1.textContent.trim().toLowerCase() === title.toLowerCase()) {
    contentH1.remove();
  }

  const body = nodeToPlainText(mainEl);
  return { title, body, charCount: body.length };
}
