'use strict';

// -----------------------------------------------
// Phase 1 で取得した Cloudflare Worker URL
// -----------------------------------------------
const WORKER_URL = 'https://notebooklm-packer.momo19830831.workers.dev';

// -----------------------------------------------
// DOM 要素の取得
// -----------------------------------------------
const urlInput   = document.getElementById('url-input');
const fetchBtn   = document.getElementById('fetch-btn');
const statusBar  = document.getElementById('status-bar');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const resultCard = document.getElementById('result-card');
const resultArea = document.getElementById('result-area');
const charCount  = document.getElementById('char-count');

// -----------------------------------------------
// イベントリスナー
// -----------------------------------------------

// ボタンクリックで取得
fetchBtn.addEventListener('click', handleFetch);

// Enter キーでも取得できるようにする
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleFetch();
});

// -----------------------------------------------
// メイン処理：URL を受け取って Worker 経由で HTML 取得
// -----------------------------------------------
async function handleFetch() {
  const targetUrl = urlInput.value.trim();

  // --- 入力チェック ---
  if (!targetUrl) {
    setStatus('error', '❌', 'URLを入力してください');
    return;
  }

  // URL 形式チェック
  try {
    new URL(targetUrl);
  } catch {
    setStatus('error', '❌', 'URLの形式が正しくありません（https:// から始まる URL を入力してください）');
    return;
  }

  // --- 取得開始 ---
  fetchBtn.disabled = true;
  resultCard.hidden = true;
  setStatus('loading', '⏳', '取得中...');

  try {
    // Worker に URL を渡して fetch
    const endpoint = `${WORKER_URL}/?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(endpoint);

    // Worker 側がエラーを返した場合
    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch {
        // JSON パース失敗は無視
      }
      setStatus('error', '❌', `取得失敗：${errMsg}`);
      return;
    }

    // 取得成功
    const html = await response.text();

    // 結果を表示
    resultArea.value = html;
    charCount.textContent = `${html.length.toLocaleString()} 文字`;
    resultCard.hidden = false;

    // 結果エリアまでスクロール
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setStatus('success', '✅', `取得完了`);

  } catch (e) {
    // ネットワークエラーなど
    setStatus('error', '❌', `エラー：${e.message}`);

  } finally {
    fetchBtn.disabled = false;
  }
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
