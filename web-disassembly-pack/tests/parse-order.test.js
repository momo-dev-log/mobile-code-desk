import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// script要素の属性まで持つ、最小の作り物の DOMParser
class FakeScript {
  constructor(attrs, text) { this.attrs = attrs; this.textContent = text; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
}
let scripts = [];
class FakeDOMParser {
  parseFromString() {
    return { title: 'T', querySelectorAll: (selector) => (selector === 'script' ? scripts : []) };
  }
}

let parseHtml;
before(async () => {
  globalThis.DOMParser = FakeDOMParser;
  ({ parseHtml } = await import('../js/parse.js'));
});

test('scriptOrder: script要素を記述順に、外部・インラインと属性つきで記録する（空のインラインは含めない）', () => {
  scripts = [
    new FakeScript({ src: '/vendor.js' }, ''),
    new FakeScript({}, '  window.CONFIG = {};  '),
    new FakeScript({}, '   '),
    new FakeScript({ src: 'https://cdn.example/lib.js', async: '' }, ''),
    new FakeScript({ src: '/app.js', type: 'module' }, ''),
    new FakeScript({ src: '/legacy.js', nomodule: '', defer: '' }, ''),
    new FakeScript({ type: 'application/ld+json' }, '{"a":1}'),
  ];
  const parsed = parseHtml('<html></html>', 'https://site.example/index.html');

  assert.deepEqual(parsed.scriptOrder, [
    { kind: 'external', url: 'https://site.example/vendor.js', sameOrigin: true, type: '', module: false, async: false, defer: false, nomodule: false },
    { kind: 'inline', label: 'インラインscript #1', chars: 'window.CONFIG = {};'.length, type: '', module: false, async: false, defer: false, nomodule: false },
    { kind: 'external', url: 'https://cdn.example/lib.js', sameOrigin: false, type: '', module: false, async: true, defer: false, nomodule: false },
    { kind: 'external', url: 'https://site.example/app.js', sameOrigin: true, type: 'module', module: true, async: false, defer: false, nomodule: false },
    { kind: 'external', url: 'https://site.example/legacy.js', sameOrigin: true, type: '', module: false, async: false, defer: true, nomodule: true },
  ]);

  // 既存の項目（通常解析が使う）は従来どおり
  assert.deepEqual(parsed.jsScripts.map((s) => s.url), [
    'https://site.example/vendor.js', 'https://cdn.example/lib.js', 'https://site.example/app.js', 'https://site.example/legacy.js',
  ]);
  assert.deepEqual(parsed.inlineScripts, ['window.CONFIG = {};']);
  assert.equal(parsed.structure.externalScriptCount, 4);
  assert.equal(parsed.structure.inlineScriptCount, 1);
});

test('非実行script（JSON-LD / importmap）はJSとして数えない', () => {
  scripts = [
    new FakeScript({ type: 'application/ld+json' }, '{"name":"Example"}'),
    new FakeScript({ type: 'importmap' }, '{"imports":{}}'),
    new FakeScript({ type: 'module', src: './main.js' }, ''),
  ];
  const parsed = parseHtml('', 'https://example.com/app/');
  assert.equal(parsed.structure.inlineScriptCount, 0);
  assert.equal(parsed.structure.externalScriptCount, 1);
  assert.equal(parsed.jsScripts[0].url, 'https://example.com/app/main.js');
});
