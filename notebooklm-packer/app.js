'use strict';

// -----------------------------------------------
// Phase 1 で取得した Cloudflare Worker URL
// -----------------------------------------------
const WORKER_URL = 'https://notebooklm-packer.momo19830831.workers.dev';

// -----------------------------------------------
// DOM 要素の取得 — 単一URL セクション（Phase 1–5）
// -----------------------------------------------
const urlInput       = document.getElementById('url-input');
const fetchBtn       = document.getElementById('fetch-btn');
const statusBar      = document.getElementById('status-bar');
const statusIcon     = document.getElementById('status-icon');
const statusText     = document.getElementById('status-text');
const resultCard     = document.getElementById('result-card');
const charCount      = document.getElementById('char-count');
const resultNote     = document.getElementById('result-note');

const tabHtmlBtn      = document.getElementById('tab-html');
const tabTextBtn      = document.getElementById('tab-text');
const tabMarkdownBtn  = document.getElementById('tab-markdown');

const panelHtml      = document.getElementById('panel-html');
const panelText      = document.getElementById('panel-text');
const panelMarkdown  = document.getElementById('panel-markdown');

const resultHtml     = document.getElementById('result-html');
const resultText     = document.getElementById('result-text');
const resultMarkdown = document.getElementById('result-markdown');
const extractMeta    = document.getElementById('extract-meta');

const copyMarkdownBtn = document.getElementById('copy-markdown-btn');
const downloadTxtBtn  = document.getElementById('download-txt-btn');
const downloadMdBtn   = document.getElementById('download-md-btn');
const copyFeedback    = document.getElementById('copy-feedback');

// -----------------------------------------------
// DOM 要素の取得 — 複数URL セクション（Phase 6）
// -----------------------------------------------
const multiUrlInput      = document.getElementById('multi-url-input');
const packBtn            = document.getElementById('pack-btn');
const packStatusBar      = document.getElementById('pack-status-bar');
const packStatusIcon     = document.getElementById('pack-status-icon');
const packStatusText     = document.getElementById('pack-status-text');
const packProgressCard   = document.getElementById('pack-progress-card');
const progressList       = document.getElementById('progress-list');
const packResultCard     = document.getElementById('pack-result-card');
const packResultMarkdown = document.getElementById('pack-result-markdown');
const packCharCount      = document.getElementById('pack-char-count');
const packResultNote     = document.getElementById('pack-result-note');
const copyPackBtn        = document.getElementById('copy-pack-btn');
const downloadPackTxtBtn = document.getElementById('download-pack-txt-btn');
const downloadPackMdBtn  = document.getElementById('download-pack-md-btn');
const packCopyFeedback   = document.getElementById('pack-copy-feedback');

// -----------------------------------------------
// 状態管理
// -----------------------------------------------
let lastHtml         = '';   // 取得した HTML ソース
let lastText         = '';   // 抽出した本文テキスト
let lastMarkdown     = '';   // 単一URL Markdown
let lastTitle        = '';   // ページタイトル（ファイル名生成用）
let currentTab       = 'html';
let lastPackMarkdown = '';   // 結合 Markdown（Phase 6）

// -----------------------------------------------
// イベントリスナー — 単一URL
// -----------------------------------------------
fetchBtn.addEventListener('click', handleFetch);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleFetch(); });

tabHtmlBtn    .addEventListener('click', () => switchTab('html'));
tabTextBtn    .addEventListener('click', () => switchTab('text'));
tabMarkdownBtn.addEventListener('click', () => switchTab('markdown'));

copyMarkdownBtn.addEventListener('click', copyMarkdown);
downloadTxtBtn .addEventListener('click', () => downloadMarkdown('txt'));
downloadMdBtn  .addEventListener('click', () => downloadMarkdown('md'));

// -----------------------------------------------
// イベントリスナー — 複数URL（Phase 6）
// -----------------------------------------------
packBtn         .addEventListener('click', handleBatchFetch);
copyPackBtn     .addEventListener('click', copyPackMarkdown);
downloadPackTxtBtn.addEventListener('click', () => downloadPackMarkdown('txt'));
downloadPackMdBtn .addEventListener('click', () => downloadPackMarkdown('md'));

// -----------------------------------------------
// タブ切り替え
// -----------------------------------------------
function switchTab(tab) {
  currentTab = tab;

  tabHtmlBtn    .classList.toggle('tab-active', tab === 'html');
  tabTextBtn    .classList.toggle('tab-active', tab === 'text');
  tabMarkdownBtn.classList.toggle('tab-active', tab === 'markdown');

  panelHtml     .hidden = tab !== 'html';
  panelText     .hidden = tab !== 'text';
  panelMarkdown .hidden = tab !== 'markdown';

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
// 共通：Worker 経由で HTML を取得する
// -----------------------------------------------
async function fetchHtmlFromWorker(url) {
  const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      if (errData.error) errMsg = errData.error;
    } catch { /* 無視 */ }
    throw new Error(errMsg);
  }
  return response.text();
}

// -----------------------------------------------
// 単一URL 処理
// -----------------------------------------------
async function handleFetch() {
  const targetUrl = urlInput.value.trim();

  if (!targetUrl) {
    setStatus('error', '❌', 'URL を入力してください');
    return;
  }
  try { new URL(targetUrl); } catch {
    setStatus('error', '❌', 'URL の形式が正しくありません（https:// から始まる URL を入力してください）');
    return;
  }

  fetchBtn.disabled = true;
  resultCard.hidden = true;
  setStatus('loading', '⏳', '取得中...');

  try {
    const html = await fetchHtmlFromWorker(targetUrl);
    lastHtml = html;
    resultHtml.value = html;

    const tmpDoc = new DOMParser().parseFromString(html, 'text/html');
    lastTitle = (tmpDoc.title || '').trim();

    setStatus('loading', '⏳', '本文を抽出中...');
    const { text, usedSelector } = extractBodyText(html);
    lastText = text;
    resultText.value = text;
    extractMeta.textContent = `抽出元：${usedSelector}`;

    setStatus('loading', '⏳', 'Markdown に変換中...');
    lastMarkdown = htmlToMarkdown(html, targetUrl);
    resultMarkdown.value = lastMarkdown;

    resultNote.textContent =
      '※ Markdown タブの「コピー」または「ダウンロード」ボタンで NotebookLM に追加できます。';

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
// Phase 5：単一URL コピー・ダウンロード
// -----------------------------------------------
function generateFilename(title, ext) {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  let safeName = title
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 50);

  if (!safeName) safeName = 'notebooklm-resource';
  return `${safeName}_${dateStr}.${ext}`;
}

async function copyMarkdown() {
  if (!lastMarkdown) {
    showCopyFeedback('❌ コピーする内容がありません', false);
    return;
  }
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    showCopyFeedback('✅ コピー完了', true);
  } catch {
    try {
      resultMarkdown.select();
      document.execCommand('copy');
      showCopyFeedback('✅ コピー完了', true);
    } catch {
      showCopyFeedback('❌ コピーに失敗しました', false);
    }
  }
}

function showCopyFeedback(message, success) {
  copyFeedback.hidden = false;
  copyFeedback.textContent = message;
  copyFeedback.className = `copy-feedback ${success ? 'copy-success' : 'copy-error'}`;
  clearTimeout(copyFeedback._timer);
  copyFeedback._timer = setTimeout(() => { copyFeedback.hidden = true; }, 3000);
}

function downloadMarkdown(ext) {
  if (!lastMarkdown) return;
  const filename = generateFilename(lastTitle, ext);
  const blob = new Blob([lastMarkdown], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------
// Phase 6：複数URL 一括処理
// -----------------------------------------------

/**
 * 入力テキストを解析し、有効・ユニークな URL の配列を返す
 */
function parseUrls(rawInput) {
  const seen = new Set();
  return rawInput
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      try { new URL(l); return true; } catch { return false; }
    })
    .filter(l => {
      if (seen.has(l)) return false;
      seen.add(l); return true;
    });
}

/**
 * 成功ページだけを 1 つの Markdown ドキュメントにまとめる
 */
function buildPackMarkdown(results) {
  const successItems = results.filter(r => r.success);
  if (!successItems.length) return '';

  const now   = new Date();
  const yyyy  = now.getFullYear();
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dd    = String(now.getDate()).padStart(2, '0');

  const header =
    `# NotebookLM 資料パック\n\n` +
    `作成日：${yyyy}-${mm}-${dd}　取得ページ数：${successItems.length}\n\n---\n\n`;

  const sections = successItems.map((item, idx) =>
    `## ${idx + 1}. ${item.title}\n\n` +
    `Source: ${item.url}\n\n` +
    `${item.md}`
  );

  return (header + sections.join('\n\n---\n\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 処理状況リストに URL 1件分の行を追加し、その li 要素を返す
 */
function addProgressItem(url) {
  const li = document.createElement('li');
  li.className = 'progress-item progress-pending';
  li.innerHTML =
    `<span class="progress-status-icon">⏸</span>` +
    `<div class="progress-info">` +
      `<span class="progress-url-text">${escapeHtml(url)}</span>` +
      `<span class="progress-detail-text">待機中</span>` +
    `</div>`;
  progressList.appendChild(li);
  return li;
}

/**
 * li 要素の状態を更新する
 * @param {HTMLElement} li
 * @param {'pending'|'loading'|'success'|'error'} state
 * @param {string} detail  表示する詳細テキスト
 */
function updateProgressItem(li, state, detail) {
  const icons = { pending: '⏸', loading: '⏳', success: '✅', error: '❌' };
  li.className = `progress-item progress-${state}`;
  li.querySelector('.progress-status-icon').textContent = icons[state] || '•';
  li.querySelector('.progress-detail-text').textContent = detail;
}

/** HTML エスケープ（innerHTML 用） */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** パック用ステータスバーを更新する */
function setPackStatus(type, icon, message) {
  packStatusBar.hidden = false;
  packStatusBar.className = `status-bar status-${type}`;
  packStatusIcon.textContent = icon;
  packStatusText.textContent = message;
}

/**
 * メイン処理：複数URL を順番に取得・変換して結合 Markdown を作る
 */
async function handleBatchFetch() {
  const urls = parseUrls(multiUrlInput.value);

  if (urls.length === 0) {
    setPackStatus('error', '❌', 'URL を1件以上入力してください（1行1URL）');
    return;
  }

  // 初期化
  packBtn.disabled     = true;
  packResultCard.hidden = true;
  packProgressCard.hidden = false;
  progressList.innerHTML  = '';
  lastPackMarkdown = '';
  setPackStatus('loading', '⏳', `0 / ${urls.length} 処理中...`);

  // 全行を「待機中」で表示
  const items = urls.map(url => addProgressItem(url));

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    setPackStatus('loading', '⏳', `${i + 1} / ${urls.length} 処理中...`);
    updateProgressItem(items[i], 'loading', '取得中...');

    try {
      const html  = await fetchHtmlFromWorker(url);
      const tmpDoc = new DOMParser().parseFromString(html, 'text/html');
      const title = (tmpDoc.title || url).trim() || url;
      const md    = htmlToMarkdown(html, url);

      results.push({ url, title, md, success: true });
      updateProgressItem(items[i], 'success', title);

    } catch (e) {
      results.push({ url, title: url, md: '', success: false, error: e.message });
      updateProgressItem(items[i], 'error', `取得失敗：${e.message}`);
    }
  }

  const successCount = results.filter(r => r.success).length;

  if (successCount === 0) {
    setPackStatus('error', '❌', 'すべての URL の取得に失敗しました');
    packBtn.disabled = false;
    return;
  }

  // 結合 Markdown を生成して表示
  lastPackMarkdown = buildPackMarkdown(results);
  packResultMarkdown.value = lastPackMarkdown;
  packCharCount.textContent =
    `${lastPackMarkdown.length.toLocaleString()} 文字`;
  packResultNote.textContent =
    `※ ${successCount} / ${urls.length} ページを結合しました。` +
    `「コピー」または「ダウンロード」で NotebookLM に追加できます。`;

  packResultCard.hidden = false;
  setPackStatus(
    'success', '✅',
    `完了：${successCount} / ${urls.length} ページ取得成功`
  );
  packResultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  packBtn.disabled = false;
}

// -----------------------------------------------
// Phase 6：パック用 コピー・ダウンロード
// -----------------------------------------------
async function copyPackMarkdown() {
  if (!lastPackMarkdown) {
    showPackCopyFeedback('❌ コピーする内容がありません', false);
    return;
  }
  try {
    await navigator.clipboard.writeText(lastPackMarkdown);
    showPackCopyFeedback('✅ コピー完了', true);
  } catch {
    try {
      packResultMarkdown.select();
      document.execCommand('copy');
      showPackCopyFeedback('✅ コピー完了', true);
    } catch {
      showPackCopyFeedback('❌ コピーに失敗しました', false);
    }
  }
}

function showPackCopyFeedback(message, success) {
  packCopyFeedback.hidden = false;
  packCopyFeedback.textContent = message;
  packCopyFeedback.className =
    `copy-feedback ${success ? 'copy-success' : 'copy-error'}`;
  clearTimeout(packCopyFeedback._timer);
  packCopyFeedback._timer = setTimeout(() => {
    packCopyFeedback.hidden = true;
  }, 3000);
}

function downloadPackMarkdown(ext) {
  if (!lastPackMarkdown) return;
  const now     = new Date();
  const yyyy    = now.getFullYear();
  const mm      = String(now.getMonth() + 1).padStart(2, '0');
  const dd      = String(now.getDate()).padStart(2, '0');
  const filename = `NotebookLM資料パック_${yyyy}${mm}${dd}.${ext}`;
  const blob    = new Blob([lastPackMarkdown], { type: 'text/plain; charset=utf-8' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -----------------------------------------------
// 共通：DOMParser でノイズ除去 → メインコンテンツ特定
// -----------------------------------------------
function prepareDoc(rawHtml) {
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

// -----------------------------------------------
// 本文抽出：プレーンテキストを返す
// -----------------------------------------------
function extractBodyText(rawHtml) {
  const { doc, mainEl, usedSelector } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();
  const bodyText = nodeToPlainText(mainEl);

  let text;
  if (!title) {
    text = bodyText;
  } else {
    const firstH1 = mainEl.querySelector('h1');
    const firstH1Text = firstH1 ? firstH1.textContent.trim() : '';
    const isDuplicate = firstH1Text.toLowerCase() === title.toLowerCase();
    text = isDuplicate ? bodyText : `${title}\n\n${bodyText}`;
  }

  return { text, usedSelector };
}

// -----------------------------------------------
// Markdown 変換：HTML → Markdown テキストを返す
// -----------------------------------------------
function htmlToMarkdown(rawHtml, sourceUrl) {
  const { doc, mainEl } = prepareDoc(rawHtml);
  const title = (doc.title || '').trim();

  const md = nodeToMarkdown(mainEl, sourceUrl);

  let result;
  if (!title) {
    result = md;
  } else {
    const firstH1 = mainEl.querySelector('h1');
    const firstH1Text = firstH1 ? firstH1.textContent.trim() : '';
    const isDuplicate = firstH1Text.toLowerCase() === title.toLowerCase();
    result = isDuplicate ? md : `# ${title}\n\n${md}`;
  }

  return result
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -----------------------------------------------
// DOM → Markdown 変換（再帰）
// -----------------------------------------------
function nodeToMarkdown(node, baseUrl) {
  if (!node) return '';

  function convert(n) {
    if (n.nodeType === Node.TEXT_NODE) {
      return n.textContent.replace(/[\r\n\t]+/g, ' ');
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = n.tagName.toLowerCase();
    const children = () => Array.from(n.childNodes).map(convert).join('');
    const inline   = () => children().trim();

    switch (tag) {
      case 'h1': return `\n\n# ${inline()}\n\n`;
      case 'h2': return `\n\n## ${inline()}\n\n`;
      case 'h3': return `\n\n### ${inline()}\n\n`;
      case 'h4': return `\n\n#### ${inline()}\n\n`;
      case 'h5': return `\n\n##### ${inline()}\n\n`;
      case 'h6': return `\n\n###### ${inline()}\n\n`;

      case 'p': { const t = inline(); return t ? `\n\n${t}\n\n` : ''; }
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';

      case 'strong': case 'b': {
        const t = inline(); return t ? `**${t}**` : '';
      }
      case 'em': case 'i': {
        const t = inline(); return t ? `*${t}*` : '';
      }

      case 'code': {
        if (n.parentElement && n.parentElement.tagName.toLowerCase() === 'pre') {
          return n.textContent;
        }
        const t = n.textContent; return t ? `\`${t}\`` : '';
      }
      case 'pre': {
        const codeEl = n.querySelector('code');
        const content = (codeEl ? codeEl.textContent : n.textContent).trim();
        return `\n\n\`\`\`\n${content}\n\`\`\`\n\n`;
      }

      case 'blockquote': {
        const inner = inline().split('\n').map(l => `> ${l}`).join('\n');
        return `\n\n${inner}\n\n`;
      }

      case 'a': {
        const href = (n.getAttribute('href') || '').trim();
        const text = inline() || href;
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
        try { return `[${text}](${new URL(href, baseUrl).href})`; }
        catch { return text; }
      }

      case 'img': {
        const src = (n.getAttribute('src') || '').trim();
        const alt = (n.getAttribute('alt') || '').trim();
        if (!src) return alt;
        try { return `![${alt}](${new URL(src, baseUrl).href})`; }
        catch { return alt; }
      }

      case 'ul': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li => `- ${Array.from(li.childNodes).map(convert).join('').trim()}`)
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'ol': {
        const items = Array.from(n.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map((li, idx) =>
            `${idx + 1}. ${Array.from(li.childNodes).map(convert).join('').trim()}`)
          .join('\n');
        return items ? `\n\n${items}\n\n` : '';
      }
      case 'li': return children();

      case 'table': return `\n\n${convertTable(n)}\n\n`;
      case 'thead': case 'tbody': case 'tfoot':
      case 'tr': case 'th': case 'td': return children();

      case 'div': case 'section': case 'article':
      case 'main': case 'figure': case 'figcaption':
      case 'aside': case 'dl': case 'dt': case 'dd': {
        const t = children(); return t ? `\n${t}\n` : '';
      }

      default: return children();
    }
  }

  function convertTable(tableNode) {
    const rows = Array.from(tableNode.querySelectorAll('tr'));
    if (!rows.length) return '';
    return rows.map((row, i) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const line = '| ' +
        cells.map(c => c.textContent.trim().replace(/\|/g, '\\|')).join(' | ') + ' |';
      if (i === 0) {
        const sep = '| ' + cells.map(() => '---').join(' | ') + ' |';
        return `${line}\n${sep}`;
      }
      return line;
    }).join('\n');
  }

  return convert(node);
}

// -----------------------------------------------
// DOM → プレーンテキスト変換
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
// 単一URL ステータスバーの表示を更新する
// -----------------------------------------------
function setStatus(type, icon, message) {
  statusBar.hidden = false;
  statusBar.className = `status-bar status-${type}`;
  statusIcon.textContent = icon;
  statusText.textContent = message;
}
