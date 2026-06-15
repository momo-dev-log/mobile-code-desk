/**
 * Web解体パック v0.2 の検出辞書。
 *
 * - JS_FEATURE_CHECKS: 「JS内キーワード検出」セクション（本文12項目）
 * - CSS_EXCERPT_CATEGORIES / JS_EXCERPT_CATEGORIES: 「CSS抜粋」「JavaScript抜粋」の観点
 *
 * 外部ライブラリ検出の辞書は別ファイル（libraries.js）に分離している。
 */

// JS内キーワード検出（本文12項目・固定）
export const JS_FEATURE_CHECKS = [
  { key: 'canvas', label: 'canvas', pattern: /canvas/i },
  { key: 'rendererDomElement', label: 'renderer.domElement', pattern: /renderer\.domElement/i },
  { key: 'getContext', label: 'getContext', pattern: /getContext/i },
  { key: 'webgl', label: 'WebGL', pattern: /webgl/i },
  { key: 'pointerEvents', label: 'pointer操作', pattern: /pointerdown|pointermove|pointerup|pointercancel/i },
  { key: 'touch', label: 'touch操作', pattern: /touchstart|touchmove|touchend|touchcancel/i },
  { key: 'mouse', label: 'mouse操作', pattern: /mousedown|mousemove|mouseup|mouseover|mouseout/i },
  { key: 'raf', label: 'requestAnimationFrame', pattern: /requestAnimationFrame/i },
  { key: 'audio', label: 'audio/play/pause', pattern: /\baudio\b|\.play\s*\(|\.pause\s*\(/i },
  { key: 'clearReset', label: 'clear/reset/wash', pattern: /\bclear\b|\breset\b|\bwash\b/i },
  { key: 'colorPalette', label: 'color/palette', pattern: /\bcolor\b|\bpalette\b/i },
  { key: 'drawResize', label: 'draw/resize', pattern: /\bdraw\b|\bresize\b/i },
];

// サマリ行に載せる8項目（JS_FEATURE_CHECKSのkeyとサマリキーの対応）
export const JS_FEATURE_SUMMARY_MAP = [
  ['canvas_js', 'canvas'],
  ['renderer_dom', 'rendererDomElement'],
  ['get_context', 'getContext'],
  ['webgl', 'webgl'],
  ['pointer', 'pointerEvents'],
  ['touch', 'touch'],
  ['mouse', 'mouse'],
  ['raf', 'raf'],
];

// CSS抜粋の観点（11カテゴリ・固定）
export const CSS_EXCERPT_CATEGORIES = [
  { key: 'bodyHtml', label: 'body/html', keywords: ['body', 'html'] },
  { key: 'canvas', label: 'canvas', keywords: ['canvas'] },
  { key: 'button', label: 'button', keywords: ['button'] },
  { key: 'toolbar', label: 'toolbar/controls/footer/dock', keywords: ['toolbar', 'controls', 'footer', 'dock'] },
  { key: 'positioning', label: 'fixed/position/z-index', keywords: ['fixed', 'position', 'z-index'] },
  { key: 'background', label: 'background', keywords: ['background'] },
  { key: 'borderRadius', label: 'border-radius', keywords: ['border-radius'] },
  { key: 'backdropFilter', label: 'backdrop-filter', keywords: ['backdrop-filter'] },
  { key: 'layout', label: 'display/flex/grid', keywords: ['display', 'flex', 'grid'] },
  { key: 'animation', label: 'animation/transition', keywords: ['animation', 'transition'] },
  { key: 'touchAction', label: 'touch-action', keywords: ['touch-action'] },
];

// JavaScript抜粋の観点（12カテゴリ・固定）
export const JS_EXCERPT_CATEGORIES = [
  { key: 'canvas', label: 'canvas', keywords: ['canvas'] },
  { key: 'rendererDomElement', label: 'renderer.domElement', keywords: ['renderer.domElement'] },
  { key: 'getContext', label: 'getContext', keywords: ['getContext'] },
  { key: 'webgl', label: 'WebGL', keywords: ['webgl'] },
  { key: 'pointerEvents', label: 'pointerdown/pointermove/pointerup', keywords: ['pointerdown', 'pointermove', 'pointerup'] },
  { key: 'touch', label: 'touch', keywords: ['touch'] },
  { key: 'mouse', label: 'mouse', keywords: ['mouse'] },
  { key: 'raf', label: 'requestAnimationFrame', keywords: ['requestAnimationFrame'] },
  { key: 'audio', label: 'audio/play/pause', keywords: ['audio', 'play', 'pause'] },
  { key: 'clearReset', label: 'clear/reset/wash', keywords: ['clear', 'reset', 'wash'] },
  { key: 'colorPalette', label: 'color/palette', keywords: ['color', 'palette'] },
  { key: 'drawResize', label: 'draw/resize', keywords: ['draw', 'resize'] },
];
