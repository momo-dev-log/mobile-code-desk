/**
 * IndexedDBラッパー
 * docs/notebooklm-tool-spec-v1.0-text.md 8章（データ構造）に準拠。
 *
 * オブジェクトストア（v3）:
 * - articleMeta (keyPath: id ＝ 正規化URL。indexes: status, categoryId)
 * - articleBody (keyPath: id ＝ articleMetaと同じ正規化URL)
 * - category    (keyPath: id)
 *
 * 注: "id" の値は正規化URLそのもの。仕様8.1の "normalizedUrl" は、
 * articleMeta内の同値フィールドとして併記する（keyPathはidのまま）。
 */

export const DB_NAME = 'notebooklm-packer';
export const DB_VERSION = 3;

export const STORE_ARTICLE_META = 'articleMeta';
export const STORE_ARTICLE_BODY = 'articleBody';
export const STORE_CATEGORY = 'category';

/**
 * データベースを開く。
 *
 * - oldVersion < 2（新規インストール・旧v1スキーマ）:
 *   既存ストアがあればすべて削除してから、v3スキーマで作り直す。
 * - oldVersion === 2:
 *   articleMeta/articleBody/categoryの既存データは保持したまま、
 *   不要になった fetchState/createdAt インデックスと pack ストアのみ削除する。
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 2) {
        // 既存ストア（旧v1スキーマ、または無し）をすべて削除してから作り直す
        for (const name of [...db.objectStoreNames]) {
          db.deleteObjectStore(name);
        }

        const metaStore = db.createObjectStore(STORE_ARTICLE_META, { keyPath: 'id' });
        metaStore.createIndex('status', 'status');
        metaStore.createIndex('categoryId', 'categoryId');

        db.createObjectStore(STORE_ARTICLE_BODY, { keyPath: 'id' });
        db.createObjectStore(STORE_CATEGORY, { keyPath: 'id' });
        return;
      }

      // oldVersion === 2: 既存データを保持したまま不要な要素のみ削除する
      const tx = event.target.transaction;
      const metaStore = tx.objectStore(STORE_ARTICLE_META);

      if (metaStore.indexNames.contains('fetchState')) {
        metaStore.deleteIndex('fetchState');
      }
      if (metaStore.indexNames.contains('createdAt')) {
        metaStore.deleteIndex('createdAt');
      }
      if (db.objectStoreNames.contains('pack')) {
        db.deleteObjectStore('pack');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
