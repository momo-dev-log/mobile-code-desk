/**
 * scorerインターフェース（唯一のAI差し込み口）
 * docs/spec.md 10章に準拠。
 *
 * 入力: 検索クエリ（string）、記事の配列（メタ＋本文）
 * 出力: 記事ごとの { score, highlights }
 *
 * v1実装: スペース区切りの語をOR条件として本文・タイトルを走査し、
 * 語ごとのヒット回数＋含有語種数ボーナス＋タイトル一致ボーナスでスコア化する。
 *
 * scoreの構成（UI側の高/中/低バッジ導出で利用する）:
 *   score = 含有語種数 * 1000 + min(本文ヒット数, 899) + (タイトル一致なら +100 のクランプ込み)
 *   いずれの語にもマッチしない記事は score = 0, highlights = [] を返す。
 *
 * 将来GemmaやWorkers AIに差し替える際は、この関数の中身だけを置き換える。
 * 入出力の形は変えない。
 *
 * @param {string} query
 * @param {Array<{ id: string, title: string, body: string }>} articles
 * @returns {Map<string, { score: number, highlights: Array<{ word: string, index: number }> }>}
 */
export function scoreArticles(query, articles) {
  const words = [...new Set(
    query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  )];

  const result = new Map();

  for (const article of articles) {
    if (words.length === 0) {
      result.set(article.id, { score: 0, highlights: [] });
      continue;
    }

    const bodyLower = (article.body || '').toLowerCase();
    const titleLower = (article.title || '').toLowerCase();

    const highlights = [];
    let matchedWordCount = 0;
    let titleMatched = false;

    for (const word of words) {
      let hitCount = 0;
      let idx = bodyLower.indexOf(word);
      while (idx !== -1) {
        highlights.push({ word, index: idx });
        hitCount += 1;
        idx = bodyLower.indexOf(word, idx + word.length);
      }

      const inTitle = titleLower.includes(word);
      if (inTitle) titleMatched = true;

      if (hitCount > 0 || inTitle) matchedWordCount += 1;
    }

    if (matchedWordCount === 0) {
      result.set(article.id, { score: 0, highlights: [] });
      continue;
    }

    const hitBonus = Math.min(highlights.length, 899 - (titleMatched ? 100 : 0));
    const titleBonus = titleMatched ? 100 : 0;
    const score = matchedWordCount * 1000 + hitBonus + titleBonus;

    result.set(article.id, { score, highlights });
  }

  return result;
}
