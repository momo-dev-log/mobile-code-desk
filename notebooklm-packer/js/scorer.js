/**
 * scorerインターフェース（唯一のAI差し込み口）
 * docs/spec.md 10章に準拠。
 *
 * 入力: 検索クエリ（string）、記事の配列（メタ＋本文）
 * 出力: 記事ごとの { score, highlights }
 *
 * v1実装（Phase 3で実装）: 語ごとのヒット回数＋含有語種数ボーナス＋
 * タイトル一致ボーナスでスコア化する。
 *
 * 将来GemmaやWorkers AIに差し替える際は、この関数の中身だけを置き換える。
 * 入出力の形は変えない。
 *
 * @param {string} query
 * @param {Array<{ id: string, title: string, body: string }>} articles
 * @returns {Map<string, { score: number, highlights: Array }>}
 */
export function scoreArticles(query, articles) {
  // Phase 3で実装する。雛形は入出力の形のみ定義する。
  const result = new Map();
  for (const article of articles) {
    result.set(article.id, { score: 0, highlights: [] });
  }
  return result;
}
