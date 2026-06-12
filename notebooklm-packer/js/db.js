/**
 * IndexedDBラッパー
 * docs/spec.md 5章（データモデル）・6章（IndexedDB設計）に準拠。
 *
 * オブジェクトストア:
 * - articleMeta (keyPath: id, index: fetchState, createdAt)
 * - articleBody (keyPath: id)
 * - pack        (keyPath: id)
 *
 * IndexedDBには抽出後のプレーンテキストのみ保存し、生HTMLは保存しない。
 */

export const DB_NAME = 'notebooklm-packer';
export const DB_VERSION = 1;

export const STORE_ARTICLE_META = 'articleMeta';
export const STORE_ARTICLE_BODY = 'articleBody';
export const STORE_PACK = 'pack';

export const DEFAULT_PACK_ID = 'default';
export const DEFAULT_PACK_NAME = '資料パック';

/**
 * データベースを開く。初回はスキーマを作成する。
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        const metaStore = db.createObjectStore(STORE_ARTICLE_META, { keyPath: 'id' });
        metaStore.createIndex('fetchState', 'fetchState');
        metaStore.createIndex('createdAt', 'createdAt');

        db.createObjectStore(STORE_ARTICLE_BODY, { keyPath: 'id' });
        db.createObjectStore(STORE_PACK, { keyPath: 'id' });
      }

      // 将来のバージョンアップ時はここに分岐を追加する。
      // 既存データの削除を伴うマイグレーションは行わない方針。
      // if (oldVersion < 2) { ... }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 起動時の孤児レコード回収。
 * fetchState=fetching のまま残っているarticleMetaを
 * failed（failReason=network）に倒す。
 * @param {IDBDatabase} db
 * @returns {Promise<number>} 回収した件数
 */
export function recoverOrphanedFetches(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readwrite');
    const store = tx.objectStore(STORE_ARTICLE_META);
    const index = store.index('fetchState');
    const range = IDBKeyRange.only('fetching');
    const request = index.openCursor(range);

    let recovered = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const meta = cursor.value;
      meta.fetchState = 'failed';
      meta.failReason = 'network';
      meta.updatedAt = new Date().toISOString();
      cursor.update(meta);
      recovered += 1;
      cursor.continue();
    };

    tx.oncomplete = () => resolve(recovered);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * articleMeta一覧を取得する（一覧表示用、bodyは含まない）。
 * @param {IDBDatabase} db
 * @returns {Promise<object[]>}
 */
export function getAllArticleMeta(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readonly');
    const store = tx.objectStore(STORE_ARTICLE_META);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 指定IDのarticleMetaを取得する。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export function getArticleMeta(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readonly');
    const request = tx.objectStore(STORE_ARTICLE_META).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 指定IDのarticleBodyを取得する（立ち読み・検索・生成時のみ呼ぶ）。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export function getArticleBody(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_BODY, 'readonly');
    const request = tx.objectStore(STORE_ARTICLE_BODY).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * articleMetaを1件保存する（取得開始時のfetching更新など）。
 * @param {IDBDatabase} db
 * @param {object} meta
 * @returns {Promise<void>}
 */
export function putArticleMeta(db, meta) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readwrite');
    tx.objectStore(STORE_ARTICLE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 取得成功時、articleMetaとarticleBodyを同一トランザクションで保存する。
 * @param {IDBDatabase} db
 * @param {object} meta
 * @param {object} body
 * @returns {Promise<void>}
 */
export function putArticleMetaAndBody(db, meta, body) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ARTICLE_META, STORE_ARTICLE_BODY], 'readwrite');
    tx.objectStore(STORE_ARTICLE_META).put(meta);
    tx.objectStore(STORE_ARTICLE_BODY).put(body);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 記事をURL一覧から削除する。
 * articleMeta・articleBody・pack.items内の参照をすべて除去する。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteArticle(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ARTICLE_META, STORE_ARTICLE_BODY, STORE_PACK], 'readwrite');
    tx.objectStore(STORE_ARTICLE_META).delete(id);
    tx.objectStore(STORE_ARTICLE_BODY).delete(id);

    const packStore = tx.objectStore(STORE_PACK);
    const packRequest = packStore.get(DEFAULT_PACK_ID);
    packRequest.onsuccess = () => {
      const pack = packRequest.result;
      if (pack && pack.items.includes(id)) {
        pack.items = pack.items.filter((itemId) => itemId !== id);
        pack.updatedAt = new Date().toISOString();
        packStore.put(pack);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * デフォルトパックを取得する。存在しない場合は新規作成して返す。
 * @param {IDBDatabase} db
 * @returns {Promise<object>}
 */
export function getOrCreatePack(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PACK, 'readwrite');
    const store = tx.objectStore(STORE_PACK);
    const request = store.get(DEFAULT_PACK_ID);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result);
        return;
      }
      const now = new Date().toISOString();
      const pack = {
        id: DEFAULT_PACK_ID,
        name: DEFAULT_PACK_NAME,
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      store.put(pack);
      resolve(pack);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * パックを保存する。
 * @param {IDBDatabase} db
 * @param {object} pack
 * @returns {Promise<void>}
 */
export function putPack(db, pack) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PACK, 'readwrite');
    tx.objectStore(STORE_PACK).put(pack);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
