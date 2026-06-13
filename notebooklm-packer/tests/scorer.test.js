import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreArticles } from '../js/scorer.js';

test('scoreArticles: OR検索で片方しか含まない記事も拾われる', () => {
  const articles = [
    { id: 'a', title: '醤油の歴史', body: 'しょうゆは日本の調味料です。'.repeat(3) },
    { id: 'b', title: 'お茶の歴史', body: '醤油について少し触れます。醤油は塩味です。' },
    { id: 'c', title: '無関係な記事', body: '今日の天気は晴れです。' },
  ];

  const scores = scoreArticles('醤油 しょうゆ', articles);

  assert.ok(scores.get('a').score > 0, 'aは「しょうゆ」のみだが拾われる');
  assert.ok(scores.get('b').score > 0, 'bは「醤油」のみだが拾われる');
  assert.equal(scores.get('c').score, 0, 'cはどちらも含まないため0');
});

test('scoreArticles: 両方の語を含む記事が片方のみの記事より上位になる', () => {
  const articles = [
    { id: 'both', title: '醤油としょうゆ', body: '醤油はしょうゆとも呼ばれます。醤油としょうゆ、醤油としょうゆ。' },
    { id: 'one', title: '醤油の話', body: '醤油について書きます。醤油は調味料です。醤油醤油醤油。' },
  ];

  const scores = scoreArticles('醤油 しょうゆ', articles);

  assert.ok(scores.get('both').score > scores.get('one').score);
});

test('scoreArticles: 空クエリは全記事score=0・highlightsなし', () => {
  const articles = [
    { id: 'a', title: 'タイトル', body: '本文本文本文' },
  ];

  const scores = scoreArticles('', articles);

  assert.deepEqual(scores.get('a'), { score: 0, highlights: [] });
});

test('scoreArticles: 大文字小文字を同一視する', () => {
  const articles = [
    { id: 'a', title: 'Title', body: 'This contains JavaScript and javascript.' },
  ];

  const scores = scoreArticles('JAVASCRIPT', articles);

  assert.equal(scores.get('a').highlights.length, 2);
});
