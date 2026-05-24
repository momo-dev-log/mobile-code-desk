'use strict';

// -----------------------------------------------
// Phase 1 で取得した Cloudflare Worker URL
// -----------------------------------------------
const WORKER_URL = 'https://notebooklm-packer.momo19830831.workers.dev';

// -----------------------------------------------
// DOM 要素の取得
// -----------------------------------------------
const urlInput       = document.getElementById('url-input');
const fetchBtn       = document.getElementById('fetch-btn');
const statusBar      = document.getElementById('status-bar');
const statusIcon     = document.getElementById('status-icon');
const statusText     = document.getElementById('status-text');
const resultCard     = document.getElementById('result-card');
const charCount      = document.getElementById('char-count');
const resultNote     = document.getElementById('result-note');

// タブボタン
const tabHtmlBtn      = document.getElementById('tab-html');
const tabTextBtn      = document.getElementById('tab-text');
const tabMarkdownBtn  = document.getElementById('tab-markdown');

// パネル
const panelHtml      = document.getElementById('panel-html');
const panelText      = document.getElementById('panel-text');
const panelMarkdown  = document.getElementById('panel-markdown');

// テキストエリア
const resultHtml     = document.getElementById('result-html');
const resultText     = document.getElementById('result-text');
const resultMarkdown = document.getElementById('result-markdown');
const extractMeta    = document.getElementById('extract-meta');

// -----------------------------------------------
// 状態管理
// -----------------------------------------------
let lastHtml     = '';   // 取得した HTML ソース
let lastText     = '';   // 抽出した本文テキスト
let lastMarkdown = '';   // Markdown 変換結果
let currentTab   = 'html';

// -----------------------------------------------
// イベントリスナー
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleFetch();
});

tabHtmlBtn    .addEventListener('click', () => switchTab('html'));
tabTextBtn    .addEventListener('click', () => switchTab('text'));
tabMarkdownBtn.addEventListener('click', () => switchTab('markdown'));

// -----------------------------------------------
// タブ切り替え
// -----------------------------------------------
function switchTab(tab) {
  currentTab = tab;

  // タブボタンのアクティブ状態
  tabHtmlBtn    .classList.toggle('tab-active', tab === 'html');
  tabTextBtn    .classList.toggle('tab-active', tab === 'text');
  tabMarkdownBtn.classList.toggle('tab-active', tab === 'markdown');

  // パネルの表示切り替え
  panelHtml     .hidden = tab !== 'html';
  panelText     .hidden = tab !== 'text';
  panelMarkdown .hidden = tab !== 'markdown';

  // 文字数カウント
  const count =
    tab === 'html'     ? lastHtml.length :
    tab === 'text'     ? lastText.length :
    /* markdown */       lastMarkdown.length;

  const label =
    tab === 'html'     ? 'HTML' :
    tab === 'text'     ? '本文' :
    /* markdown */       'Markdown';

  charCount.textContent = count ? `${count.toLocaleString()} 文字（${label}）` : '';
}

// -----------------------------------------------
// メイン処理：URL → Worker → HTML 取得 → 変換
// -----------------------------------------------
async function handleFetch() {
  const targetUrl = urlInput.value.trim();

  // 入力チェック
  if (!targetUrl) {
    setStatus('error', '❌', 'URL を入力してください');
    return;
  }
  try {
    new URL(targetUrl);
  } catch {
    setStatus('error', '❌', 'URL の形式が正しくありません（https:// から始まる URL を入力してください）');
    return;
  }

  // 取得開始
  fetchBtn.disabled = true;
  resultCard.hidden = true;
  setStatus('loading', '⏳', '取得中...');

  try {
    const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(endpoint);

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch { /* 無視 */ }
      setStatus('error', '❌', `取得失敗：${errMsg}`);
      return;
    }

    const html = await response.text();
    lastHtml = html;
    resultHtml.value = html;

    // 本文抽出
    setStatus('loading', '⏳', '本文を抽出中...');
    const { text, usedSelector } = extractBodyText(html);
    lastText = text;
    resultText.value = text;
    extractMeta.textContent = `抽出元：${usedSelector}`;

    // Markdown 変換
    setStatus('loading', '⏳', 'Markdown に変換中...');
    lastMarkdown = htmlToMarkdown(html, targetUrl);
    resultMarkdown.value = lastMarkdown;

    // 注記更新
    resultNote.textContent =
      '※ Markdown タブの内容を NotebookLM に貼り付けて活用できます。';

    // 現在のタブに合わせて表示
    resultCard.hidden = false;
    switchTab(currentTab);
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('success', '✅', '取得・抽出・Markdown 変換完了');

  } catch (e) {
    setStatus('error', '❌', `エラー：${e.message}`);
  } finally {
    fetchBtn.disabled = false;
  }
}

// -----------------------------------------------
// 共通：DOMParser でノイズ除去 → メインコンテンツ特定
// -----------------------------------------------
function prepareDoc(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 不要要素を除去
  [
    'script', 'style', 'noscript',
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[aria-hidden="true"]',
  ].forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

  // メインコンテンツ候補（優先順）
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

// -----------------------------------------------
// 本文抽出：プレーンテキストを返す（Phase 3 から継続）
// -----------------------------------------------
function extractBodyText(rawHtml) {
  const { doc, mainEl, usedSelector } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();
  const bodyText = nodeToPlainText(mainEl);
  const text = title
    ? `${title}\n${'─'.repeat(Math.min(title.length * 2, 40))}\n\n${bodyText}`
    : bodyText;
  return { text, usedSelector };
}

// -----------------------------------------------
// Markdown 変換：HTML → Markdown テキストを返す（Phase 4 新規）
// -----------------------------------------------
function htmlToMarkdown(rawHtml, sourceUrl) {
  const { doc, mainEl } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();

  const md = nodeToMarkdown(mainEl, sourceUrl);
  const result = title ? `# ${title}\n\n${md}` : md;

  return result
    .replace(/\n{3,}/g, '\n\n')   // 3行以上の空行を2行に圧縮
    .trim();
}

// -----------------------------------------------
// DOM → Markdown 変換（再帰）
// -----------------------------------------------
function nodeToMarkdown(node, baseUrl) {
  if (!node) return '';

  function convert(n) {
    // テキストノード
    if (n.nodeType === Node.TEXT_NODE) {
      return n.textContent.replace(/[\r\n\t]+/g, ' ');
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = n.tagName.toLowerCase();

    // 子ノードを再帰変換（ブロック・インライン共通）
    const children = () =>
      Array.from(n.childNodes).map(convert).join('');

    // インライン要素として子を結合（前後の空白をトリム）
    const inline = () => children().trim();

    switch (tag) {

      // ---- 見出し ----
      case 'h1': return `\n\n# ${inline()}\n\n`;
      case 'h2': return `\n\n## ${inline()}\n\n`;
      case 'h3': return `\n\n### ${inline()}\n\n`;
      case 'h4': return `\n\n#### ${inline()}\n\n`;
      case 'h5': return `\n\n##### ${inline()}\n\n`;
      case 'h6': return `\n\n###### ${inline()}\n\n`;

      // ---- 段落 ----
      case 'p': {
        const t = inline();
        return t ? `\n\n${t}\n\n` : '';
      }

      // ---- 改行・区切り ----
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';

      // ---- インライン装飾 ----
      case 'strong': case 'b': {
        const t = inline();
        return t ? `**${t}**` : '';
      }
      case 'em': case 'i': {
        const t = inline();
        return t ? `*${t}*` : '';
      }

      // ---- コード ----
      case 'code': {
        // pre の直下の code はバッククォートを付けない（pre 側で処理）
        if (n.parentElement && n.parentElement.tagName.toLowerCase() === 'pre') {
          return n.textContent;
        }
        const t = n.textContent;
        return t ? `\`${t}\`` : '';
      }
      case 'pre': {
        const codeEl = n.querySelector('code');
        const content = (codeEl ? codeEl.textContent : n.textContent).trim();
        return `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }

      // ---- 引用 ----
      case 'blockquote': {
        const inner = inline()
          .split('\n')
          .map(l => `> ${l}`)
          .join('\n');
        return `\n\n${inner}\n\n`;
      }

      // ---- リンク ----
      case 'a': {
        const href = (n.getAttribute('href') || '').trim();
        const text = inline() || href;
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
          return text;
        }
        try {
          const abs = new URL(href, baseUrl).href;
          return `[${text}](${abs})`;
        } catch {
          return text;
        }
      }

      // ---- 画像 ----
      case 'img': {
        const src = (n.getAttribute('src') || '').trim();
        const alt = (n.getAttribute('alt') || '').trim();
        if (!src) return alt;
        try {
          const abs = new URL(src, baseUrl).href;
          return `![${alt}](${abs})`;
        } catch {
          return alt;
        }
      }

      // ---- リスト ----
      case 'ul': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li =>
            `- ${Array.from(li.childNodes).map(convert).join('').trim()}`
          )
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'ol': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map((li, idx) =>
            `${idx + 1}. ${Array.from(li.childNodes).map(convert).join('').trim()}`
          )
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'li': return children();  // ul / ol に委ねる

      // ---- テーブル ----
      case 'table': return `\n\n${convertTable(n)}\n\n`;
      case 'thead': case 'tbody': case 'tfoot': return children();
      case 'tr': return children();
      case 'th': case 'td': return children();

      // ---- ブロック要素（汎用） ----
      case 'div': case 'section': case 'article':
      case 'main': case 'figure': case 'figcaption':
      case 'aside': case 'dl': case 'dt': case 'dd': {
        const t = children();
        return t ? `\n${t}\n` : '';
      }

      // ---- その他（インライン扱い） ----
      default: return children();
    }
  }

  // テーブルをシンプルな Markdown テーブルに変換
  function convertTable(tableNode) {
    const rows = Array.from(tableNode.querySelectorAll('tr'));
    if (!rows.length) return '';

    const lines = rows.map((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const line = '| ' +
        cells.map(c => c.textContent.trim().replace(/\|/g, '\\|')).join(' | ') +
        ' |';
      if (i === 0) {
        const sep = '| ' + cells.map(() => '---').join(' | ') + ' |';
        return `${line}\n${sep}`;
      }
      return line;
    });

    return lines.join('\n');
  }

  return convert(node);
}

// -----------------------------------------------
// DOM → プレーンテキスト変換（Phase 3 から継続）
// -----------------------------------------------
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

function nodeToPlainText(node) {
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

// -----------------------------------------------
// ステータスバーの表示を更新する
// -----------------------------------------------
function setStatus(type, icon, message) {
  statusBar.hidden = false;
  statusBar.className = `status-bar status-${type}`;
  statusIcon.textContent = icon;
  statusText.textContent = message;
}
