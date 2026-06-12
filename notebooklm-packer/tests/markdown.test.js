import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackMarkdown, sanitizePackName, generateFilename } from '../js/markdown.js';

test('buildPackMarkdown: 目次・メタヘッダ・本文を含むMarkdownを生成する', () => {
  const articles = [
    {
      title: '記事タイトルA',
      originalUrl: 'https://example.com/article',
      domain: 'example.com',
      fetchedAt: '2026-06-10T09:12:00.000Z',
      charCount: 4200,
      body: '本文Aの内容です。',
    },
    {
      title: '記事タイトルB',
      originalUrl: 'https://example.org/article',
      domain: 'example.org',
      fetchedAt: '2026-06-11T01:00:00.000Z',
      charCount: 300,
      body: '本文Bの内容です。',
    },
  ];

  const { markdown, skippedCount } = buildPackMarkdown('資料パック', articles);

  assert.equal(skippedCount, 0);
  assert.match(markdown, /^# 資料パック/);
  assert.match(markdown, /## 目次/);
  assert.match(markdown, /1\. 記事タイトルA（example\.com）/);
  assert.match(markdown, /2\. 記事タイトルB（example\.org）/);
  assert.match(markdown, /## 1\. 記事タイトルA/);
  assert.match(markdown, /- 元URL: https:\/\/example\.com\/article/);
  assert.match(markdown, /本文Aの内容です。/);
  assert.match(markdown, /## 2\. 記事タイトルB/);
});

test('buildPackMarkdown: bodyが無い記事はスキップし末尾に注記する', () => {
  const articles = [
    {
      title: '記事タイトルA',
      originalUrl: 'https://example.com/article',
      domain: 'example.com',
      fetchedAt: '2026-06-10T09:12:00.000Z',
      charCount: 4200,
      body: '本文A',
    },
    {
      title: '記事タイトルB',
      originalUrl: 'https://example.org/article',
      domain: 'example.org',
      fetchedAt: '2026-06-11T01:00:00.000Z',
      charCount: 0,
      body: null,
    },
  ];

  const { markdown, skippedCount } = buildPackMarkdown('資料パック', articles);

  assert.equal(skippedCount, 1);
  assert.match(markdown, /1件をスキップしました/);
});

test('sanitizePackName: ファイル名に使えない文字を_に置換する', () => {
  assert.equal(sanitizePackName('資料/パック'), '資料_パック');
  assert.equal(sanitizePackName('a:b*c?d"e<f>g|h'), 'a_b_c_d_e_f_g_h');
});

test('generateFilename: {パック名}_YYYYMMDD_HHmm.{ext} 形式になる', () => {
  const date = new Date(2026, 5, 12, 14, 30); // 2026-06-12 14:30 (月は0始まり)
  assert.equal(generateFilename('資料パック', 'md', date), '資料パック_20260612_1430.md');
});
