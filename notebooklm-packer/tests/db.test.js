import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  DB_NAME,
  STORE_ARTICLE_META,
  STORE_ARTICLE_BODY,
  STORE_CATEGORY,
  STORE_PACK,
  openDb,
  existsArticleMeta,
  saveSuccessArticle,
  saveFailedArticle,
  deleteArticleRecord,
  deleteFailedUrl,
  assignCategory,
  setExported,
  getAllCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  getArticleMeta,
  getArticleBody,
  getAllArticleMeta,
} from '../js/db.js';

// 各テストで開いたDB接続。afterEachでまとめてcloseする。
let openConnections = [];

async function openTrackedDb() {
  const db = await openDb();
  openConnections.push(db);
  return db;
}

// 各テスト前にDBを削除し、新規スキーマでまっさらな状態から開始する。
beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

// 各テスト後にDB接続をcloseし、次のbeforeEachでのdeleteDatabaseをブロックしないようにする。
afterEach(() => {
  for (const db of openConnections) {
    db.close();
  }
  openConnections = [];
});

function makeMeta(id, overrides = {}) {
  return {
    id,
    normalizedUrl: id,
    originalUrl: id,
    title: 'タイトル',
    domain: 'example.com',
    categoryId: '',
    isExported: false,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('openDb: v2スキーマで articleMeta/articleBody/category/pack ストアが作られる', async () => {
  const db = await openTrackedDb();
  const names = [...db.objectStoreNames];
  assert.ok(names.includes(STORE_ARTICLE_META));
  assert.ok(names.includes(STORE_ARTICLE_BODY));
  assert.ok(names.includes(STORE_CATEGORY));
  assert.ok(names.includes(STORE_PACK));

  const tx = db.transaction(STORE_ARTICLE_META, 'readonly');
  const store = tx.objectStore(STORE_ARTICLE_META);
  const indexNames = [...store.indexNames];
  assert.ok(indexNames.includes('status'));
  assert.ok(indexNames.includes('categoryId'));
});

test('saveSuccessArticle: meta(status=success)とbodyを保存する', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/a';
  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });

  const meta = await getArticleMeta(db, id);
  assert.equal(meta.status, 'success');
  assert.equal(meta.id, id);

  const body = await getArticleBody(db, id);
  assert.equal(body.body, '本文');
});

test('saveFailedArticle: meta(status=failed)のみを保存し、bodyは持たない', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/failed';
  await saveFailedArticle(db, makeMeta(id));

  const meta = await getArticleMeta(db, id);
  assert.equal(meta.status, 'failed');

  const body = await getArticleBody(db, id);
  assert.equal(body, undefined);
});

test('existsArticleMeta: 未保存IDはfalse、保存後はtrue（条件11 重複ガード）', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/dup';

  assert.equal(await existsArticleMeta(db, id), false);

  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });

  assert.equal(await existsArticleMeta(db, id), true);
});

test('deleteArticleRecord: meta/bodyを削除し再取り込み可能になる（条件10）', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/reimport';
  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });

  await deleteArticleRecord(db, id);

  assert.equal(await existsArticleMeta(db, id), false);
  assert.equal(await getArticleMeta(db, id), undefined);
  assert.equal(await getArticleBody(db, id), undefined);
});

test('deleteFailedUrl: 失敗URLのmetaを削除する', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/failed-delete';
  await saveFailedArticle(db, makeMeta(id));

  await deleteFailedUrl(db, id);

  assert.equal(await getArticleMeta(db, id), undefined);
});

test('assignCategory: 記事のcategoryIdを更新する', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/assign';
  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });

  await assignCategory(db, id, 'cat-1');

  const meta = await getArticleMeta(db, id);
  assert.equal(meta.categoryId, 'cat-1');
});

test('setExported: isExportedをtrueにする', async () => {
  const db = await openTrackedDb();
  const id = 'https://example.com/export';
  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });

  await setExported(db, id);

  const meta = await getArticleMeta(db, id);
  assert.equal(meta.isExported, true);
});

test('createCategory: 正常に作成できる', async () => {
  const db = await openTrackedDb();
  const category = await createCategory(db, '資料');

  assert.equal(category.name, '資料');
  assert.ok(category.id);
  assert.ok(category.createdAt);

  const categories = await getAllCategories(db);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, '資料');
});

test('createCategory: 空欄・空白のみは不可', async () => {
  const db = await openTrackedDb();
  await assert.rejects(() => createCategory(db, ''), /空にできません/);
  await assert.rejects(() => createCategory(db, '   '), /空にできません/);
});

test('createCategory: trim()後の完全一致で同名は不可（大文字小文字は区別する）', async () => {
  const db = await openTrackedDb();
  await createCategory(db, '資料');

  await assert.rejects(() => createCategory(db, '資料'), /既に存在します/);
  await assert.rejects(() => createCategory(db, '  資料  '), /既に存在します/);

  // 大文字小文字が異なる場合は別名として許可される
  await createCategory(db, 'Test');
  const created = await createCategory(db, 'test');
  assert.equal(created.name, 'test');
});

test('renameCategory: 正常に名前を変更できる', async () => {
  const db = await openTrackedDb();
  const category = await createCategory(db, '旧名');

  await renameCategory(db, category.id, '新名');

  const categories = await getAllCategories(db);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, '新名');
});

test('renameCategory: 空欄・他カテゴリと同名は不可（自分自身は除外）', async () => {
  const db = await openTrackedDb();
  const a = await createCategory(db, 'A');
  const b = await createCategory(db, 'B');

  await assert.rejects(() => renameCategory(db, a.id, ''), /空にできません/);
  await assert.rejects(() => renameCategory(db, a.id, 'B'), /既に存在します/);

  // 自分自身と同じ名前への変更（実質変更なし）は許可される
  await renameCategory(db, b.id, 'B');
  const categories = await getAllCategories(db);
  assert.equal(categories.find((c) => c.id === b.id).name, 'B');
});

test('deleteCategory: 所属記事を未分類に戻し、記事自体は削除しない（条件12）', async () => {
  const db = await openTrackedDb();
  const category = await createCategory(db, '資料');

  const id = 'https://example.com/categorized';
  await saveSuccessArticle(db, makeMeta(id), { id, body: '本文' });
  await assignCategory(db, id, category.id);

  await deleteCategory(db, category.id);

  const categories = await getAllCategories(db);
  assert.equal(categories.length, 0);

  const meta = await getArticleMeta(db, id);
  assert.ok(meta, '記事自体は削除されない');
  assert.equal(meta.categoryId, '');
});

test('DBを再オープンしてもデータが保持される（条件15の前提）', async () => {
  const db1 = await openTrackedDb();
  const id = 'https://example.com/persist';
  await saveSuccessArticle(db1, makeMeta(id), { id, body: '本文' });
  db1.close();

  const db2 = await openTrackedDb();
  const meta = await getArticleMeta(db2, id);
  assert.equal(meta.id, id);

  const all = await getAllArticleMeta(db2);
  assert.equal(all.length, 1);
});
