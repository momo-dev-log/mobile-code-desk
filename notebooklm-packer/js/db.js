/**
 * IndexedDBラッパー
 * docs/notebooklm-tool-spec-v1.0-text.md 8章（データ構造）に準拠。
 *
 * オブジェクトストア（v2）:
 * - articleMeta (keyPath: id ＝ 正規化URL。indexes: status, categoryId, fetchState, createdAt)
 * - articleBody (keyPath: id ＝ articleMetaと同じ正規化URL)
 * - category    (keyPath: id)
 * - pack        (keyPath: id) … フェーズ移行中の暫定残置。フェーズ3で物理削除する。
 *
 * 旧v1スキーマのデータは引き継がない。DB_VERSIONを上げ、
 * 既存ストアをすべて作り直す。
 *
 * 注: "id" の値は正規化URLそのもの。仕様8.1の "normalizedUrl" は、
 * articleMeta内の同値フィールドとして併記する（keyPathはidのまま）。
 */

export const DB_NAME = 'notebooklm-packer';
export const DB_VERSION = 2;

export const STORE_ARTICLE_META = 'articleMeta';
export const STORE_ARTICLE_BODY = 'articleBody';
export const STORE_CATEGORY = 'category';
export const STORE_PACK = 'pack';

// フェーズ移行中の暫定残置（フェーズ3で削除）
export const DEFAULT_PACK_ID = 'default';
export const DEFAULT_PACK_NAME = '資料パック';

/**
 * データベースを開く。
 * onupgradeneeded時、既存の全オブジェクトストアを削除してv2スキーマで作り直す。
 * （新仕様では既存IndexedDBデータを引き継がない）
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 既存ストアをすべて削除してから作り直す（旧データは引き継がない）
      for (const name of [...db.objectStoreNames]) {
        db.deleteObjectStore(name);
      }

      const metaStore = db.createObjectStore(STORE_ARTICLE_META, { keyPath: 'id' });
      metaStore.createIndex('status', 'status');
      metaStore.createIndex('categoryId', 'categoryId');
      // 旧UI(main.js)のrecoverOrphanedFetches等が参照するため、互換用に残す。
      // 新仕様のmetaはこれらのフィールドを持たないため、該当レコードは0件になる。
      metaStore.createIndex('fetchState', 'fetchState');
      metaStore.createIndex('createdAt', 'createdAt');

      db.createObjectStore(STORE_ARTICLE_BODY, { keyPath: 'id' });
      db.createObjectStore(STORE_CATEGORY, { keyPath: 'id' });

      // フェーズ移行中の暫定残置（フェーズ3で削除）
      db.createObjectStore(STORE_PACK, { keyPath: 'id' });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 起動時の孤児レコード回収。
 * fetchState=fetching のまま残っているarticleMetaを
 * failed（failReason=network）に倒す。
 *
 * 新仕様のarticleMetaはfetchStateを持たないため、通常0件で完了する。
 * 旧UI(main.js)が起動時に呼ぶため、互換用に残す。
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
 * 指定IDのarticleBodyを取得する。
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
 * 記事をURL一覧から削除する（旧UI互換）。
 * articleMeta・articleBody・pack.items内の参照をすべて除去する。
 *
 * フェーズ移行中の暫定残置。新仕様のフローでは deleteArticleRecord を使う。
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
 * デフォルトパックを取得する。存在しない場合は新規作成して返す（旧UI互換）。
 *
 * フェーズ移行中の暫定残置。フェーズ3で物理削除する。
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
 * パックを保存する（旧UI互換）。
 *
 * フェーズ移行中の暫定残置。フェーズ3で物理削除する。
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

// =================================================
// 新仕様（v1.0）用の操作
// =================================================

/**
 * 指定IDのarticleMetaが既に存在するかを判定する（重複ガード用）。
 * statusがsuccess/failedいずれであっても、記録があればtrueを返す。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export function existsArticleMeta(db, id) {
  return getArticleMeta(db, id).then((meta) => meta !== undefined);
}

/**
 * 取得成功記事を保存する。articleMetaとarticleBodyを同一トランザクションで保存する。
 * @param {IDBDatabase} db
 * @param {{
 *   id: string,
 *   normalizedUrl: string,
 *   originalUrl: string,
 *   title: string,
 *   domain: string,
 *   categoryId: string,
 *   isExported: boolean,
 *   fetchedAt: string,
 * }} meta status は 'success' に強制される
 * @param {{ id: string, body: string }} body
 * @returns {Promise<void>}
 */
export function saveSuccessArticle(db, meta, body) {
  return putArticleMetaAndBody(db, { ...meta, status: 'success' }, body);
}

/**
 * 取得失敗URLを記録する。articleMetaのみを保存し、articleBodyは持たない。
 * @param {IDBDatabase} db
 * @param {{
 *   id: string,
 *   normalizedUrl: string,
 *   originalUrl: string,
 *   title: string,
 *   domain: string,
 *   categoryId: string,
 *   isExported: boolean,
 *   fetchedAt: string,
 * }} meta status は 'failed' に強制される
 * @returns {Promise<void>}
 */
export function saveFailedArticle(db, meta) {
  return putArticleMeta(db, { ...meta, status: 'failed' });
}

/**
 * 記事を削除する（articleMeta・articleBodyの両方）。packストアは触らない。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteArticleRecord(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ARTICLE_META, STORE_ARTICLE_BODY], 'readwrite');
    tx.objectStore(STORE_ARTICLE_META).delete(id);
    tx.objectStore(STORE_ARTICLE_BODY).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 取得失敗URLを削除する（articleMetaのみ。articleBodyは元々存在しない）。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteFailedUrl(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readwrite');
    tx.objectStore(STORE_ARTICLE_META).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 記事にカテゴリを割り当てる（未分類に戻す場合は categoryId に '' を渡す）。
 * @param {IDBDatabase} db
 * @param {string} articleId
 * @param {string} categoryId
 * @returns {Promise<void>}
 */
export function assignCategory(db, articleId, categoryId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readwrite');
    const store = tx.objectStore(STORE_ARTICLE_META);
    const request = store.get(articleId);
    request.onsuccess = () => {
      const meta = request.result;
      if (!meta) {
        resolve();
        return;
      }
      meta.categoryId = categoryId;
      store.put(meta);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 記事のisExportedをtrueにする。
 * @param {IDBDatabase} db
 * @param {string} articleId
 * @returns {Promise<void>}
 */
export function setExported(db, articleId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ARTICLE_META, 'readwrite');
    const store = tx.objectStore(STORE_ARTICLE_META);
    const request = store.get(articleId);
    request.onsuccess = () => {
      const meta = request.result;
      if (!meta) {
        resolve();
        return;
      }
      meta.isExported = true;
      store.put(meta);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * カテゴリ一覧を取得する。
 * @param {IDBDatabase} db
 * @returns {Promise<object[]>}
 */
export function getAllCategories(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATEGORY, 'readonly');
    const request = tx.objectStore(STORE_CATEGORY).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * カテゴリ名のtrim()後重複チェック（完全一致・大文字小文字区別）。
 * @param {object[]} categories
 * @param {string} trimmedName
 * @param {string} [excludeId] 名前変更時、自分自身を除外するため
 * @returns {boolean}
 */
function hasDuplicateCategoryName(categories, trimmedName, excludeId) {
  return categories.some((c) => c.id !== excludeId && c.name === trimmedName);
}

/**
 * カテゴリを作成する。
 * 名前は空欄不可・trim()後の完全一致で同名不可。
 * @param {IDBDatabase} db
 * @param {string} name
 * @returns {Promise<object>} 作成したカテゴリ { id, name, createdAt }
 */
export async function createCategory(db, name) {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') {
    throw new Error('カテゴリ名は空にできません');
  }

  const categories = await getAllCategories(db);
  if (hasDuplicateCategoryName(categories, trimmed)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }

  const category = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATEGORY, 'readwrite');
    tx.objectStore(STORE_CATEGORY).put(category);
    tx.oncomplete = () => resolve(category);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * カテゴリ名を変更する。
 * 名前は空欄不可・trim()後の完全一致で同名不可（自分自身は除外）。
 * @param {IDBDatabase} db
 * @param {string} id
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function renameCategory(db, id, name) {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') {
    throw new Error('カテゴリ名は空にできません');
  }

  const categories = await getAllCategories(db);
  if (hasDuplicateCategoryName(categories, trimmed, id)) {
    throw new Error('同じ名前のカテゴリが既に存在します');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATEGORY, 'readwrite');
    const store = tx.objectStore(STORE_CATEGORY);
    const request = store.get(id);
    request.onsuccess = () => {
      const category = request.result;
      if (!category) {
        resolve();
        return;
      }
      category.name = trimmed;
      store.put(category);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * カテゴリを削除する。
 * 削除されたカテゴリに属していた記事は未分類（categoryId = ''）に戻す。
 * 記事自体は削除しない。
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteCategory(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ARTICLE_META, STORE_CATEGORY], 'readwrite');
    const metaStore = tx.objectStore(STORE_ARTICLE_META);
    const categoryStore = tx.objectStore(STORE_CATEGORY);

    const index = metaStore.index('categoryId');
    const range = IDBKeyRange.only(id);
    const cursorRequest = index.openCursor(range);

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        categoryStore.delete(id);
        return;
      }
      const meta = cursor.value;
      meta.categoryId = '';
      cursor.update(meta);
      cursor.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
