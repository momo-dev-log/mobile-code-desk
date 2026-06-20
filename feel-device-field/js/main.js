/* =========================================================================
 * 感触装置 — scalar core gate test v1
 *
 * 目的: 「指は場へ刺激を入れるだけで、指が去った後は既存の場だけが
 *       diffusion/dissipationで自律的に伝播し、収まる」ことだけを検証する。
 *       媒質の見た目(墨/水/煙等)、筆跡、始点/終点の整え、velocity/advection
 *       等は今回の検証対象ではない。
 *
 * 入力: pointerdownの1回だけ、コンパクトなscalar disturbanceを加える。
 *       pointermove/pointerup後は新しい入力を一切加えない。
 * ========================================================================= */

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import {
  FIELD_RESOLUTION,
  fieldComputeShader,
  displayVertexShader,
  displayFragmentShader,
} from './shaders.js?v=unbuilt';

const TAG = '[feel-device-field]';
const log = (...args) => console.log(TAG, ...args);
const logError = (...args) => console.error(TAG, ...args);

// この 'build:unbuilt' は、Pagesデプロイ用ワークフロー（.github/workflows/
// deploy-pages.yml）がstaging artifact内だけで実際のGITHUB_SHA短縮値に
// 書き換える置き換え対象の文字列そのもの。ソース上の値を手で書き換えない。
// この文字列のままHUDに出ている場合、ビルド未注入（mainブランチ直配信や
// ローカル確認など）であることを意味する。
const BUILD = 'build:unbuilt';

// scalar core gate test用の最低限の数値。
// 採用根拠・概算はPR本文に記載（離散diffusion/dissipation式と閾値別の
// 中心濃度・可視半径の概算）。
const FIELD_PARAMS = {
  tapRadius: 0.016,        // UV単位。コンパクトな初期disturbanceの半径(128解像度で約2texel)
  tapStrength: 1.0,        // 初期disturbanceの中心強度
  diffusionStrength: 0.9,  // 60fps基準のdiffusion混合係数(0〜1の凸結合、発散しない)
  decay: 0.9985,           // 60fps基準の1フレームあたりのdissipation倍率
};

const canvas = document.getElementById('gl');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
} catch (e) {
  logError('WebGLRenderer の作成に失敗', e);
  throw e;
}
log('WebGLRenderer 作成OK. isWebGL2 =', renderer.capabilities.isWebGL2);

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── GPUComputationRenderer: scalar fieldを1つだけ持つ ──
const gpuCompute = new GPUComputationRenderer(FIELD_RESOLUTION, FIELD_RESOLUTION, renderer);
gpuCompute.setDataType(THREE.HalfFloatType);
log(`GPUComputationRenderer 作成. resolution=${FIELD_RESOLUTION}x${FIELD_RESOLUTION} dataType=HalfFloatType`);

const fieldTexture = gpuCompute.createTexture();
log('初期fieldテクスチャ作成OK (ゼロ初期化)');

const fieldVariable = gpuCompute.addVariable('textureField', fieldComputeShader, fieldTexture);
gpuCompute.setVariableDependencies(fieldVariable, [fieldVariable]);

fieldVariable.minFilter = THREE.NearestFilter;
fieldVariable.magFilter = THREE.NearestFilter;

fieldVariable.material.uniforms.uPointer = { value: new THREE.Vector2(0.5, 0.5) };
fieldVariable.material.uniforms.uPointerActive = { value: 0 };
fieldVariable.material.uniforms.uTapRadius = { value: FIELD_PARAMS.tapRadius };
fieldVariable.material.uniforms.uTapStrength = { value: FIELD_PARAMS.tapStrength };
fieldVariable.material.uniforms.uDiffusionStrength = { value: FIELD_PARAMS.diffusionStrength };
fieldVariable.material.uniforms.uDecay = { value: FIELD_PARAMS.decay };
fieldVariable.material.uniforms.uDt = { value: 0 };
log('field variable 作成OK. filter=NEAREST');

const initError = gpuCompute.init();
if (initError !== null) {
  logError('GPUComputationRenderer.init() 失敗:', initError);
} else {
  log('GPUComputationRenderer.init() OK');
}

// NEAREST → Linear。128x128を画面サイズへ拡大表示するときのブロック状の
// 階段を補間で滑らかにする(field更新の挙動は変えない)。
// half float + linearはWebGL2ならコアで使えるが、WebGL1ではOES_texture_half_float_linear
// 拡張が無いと効かずテクスチャがincompleteになり黒画面になる。USE_LINEARを
// falseに戻すだけでNEARESTへ復帰できるようにしておく。
const USE_LINEAR = true; // 黒画面になったらfalseに戻す（NEARESTへ）
const fieldFilter = USE_LINEAR ? THREE.LinearFilter : THREE.NearestFilter;
fieldVariable.renderTargets.forEach((rt) => {
  rt.texture.minFilter = fieldFilter;
  rt.texture.magFilter = fieldFilter;
});

const gl = renderer.getContext();
const linearUsable = renderer.capabilities.isWebGL2
  ? true // WebGL2のhalf floatはlinearがコアで使える
  : !!gl.getExtension('OES_texture_half_float_linear');
log('linear filter usable?', linearUsable, '/ USE_LINEAR =', USE_LINEAR);

// Erudaを開かずに反映状況を確認できるよう、画面左下のHUDに状態を出す。
const hud = document.getElementById('hud');
hud.textContent = `${BUILD} | scalar | diffusion:ON | input:tap`;

// ── 表示用シーン: フルスクリーン1枚のPlaneにfieldをそのまま映す ──
// 無彩色の中立配色(墨/紙/水/煙を想起させない)。
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const displayMaterial = new THREE.ShaderMaterial({
  vertexShader: displayVertexShader,
  fragmentShader: displayFragmentShader,
  uniforms: {
    uFieldTexture: { value: null },
    uBgColor: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
    uFgColor: { value: new THREE.Vector3(0.95, 0.95, 0.95) },
  },
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial));

// ── pointer / touch 入力 ──
// 1本指のみ追跡。pointerdownの1回だけ、その場へscalar disturbanceを入れる。
// pointermove/pointerup後は場へ何も足さない(長押ししても最初の1回だけ)。
let activePointerId = null;
let pendingTapInjection = false;

function clientToUv(clientX, clientY) {
  return new THREE.Vector2(
    clientX / window.innerWidth,
    1 - clientY / window.innerHeight, // gl_FragCoord/vUvはy=0が下のため反転
  );
}

function setTapUv(uv) {
  const target = fieldVariable.material.uniforms.uPointer.value;
  target.x = uv.x;
  target.y = uv.y;
}

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  setTapUv(clientToUv(e.clientX, e.clientY));
  pendingTapInjection = true; // 実際の注入は次のanimateフレームで1回だけ行う

  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  log('pointerdown', e.pointerType, e.clientX.toFixed(1), e.clientY.toFixed(1));
  e.preventDefault();
}, { passive: false });

// fieldには何も入力しない。指を押したままのスクロール抑止のためだけに
// preventDefaultする。
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  e.preventDefault();
}, { passive: false });

function release(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  log('pointerup/cancel', e.pointerType);
  e.preventDefault();
}
canvas.addEventListener('pointerup', release, { passive: false });
canvas.addEventListener('pointercancel', release, { passive: false });

// pointerdown直後の1フレームだけuPointerActiveを1にし、即座に0へ戻す。
// これ以降、次のpointerdownが来るまで場への入力は一切起きない。
function updateTapInjection() {
  if (pendingTapInjection) {
    fieldVariable.material.uniforms.uPointerActive.value = 1;
    pendingTapInjection = false;
  } else {
    fieldVariable.material.uniforms.uPointerActive.value = 0;
  }
}

// ── メインループ ──
let frameCount = 0;
let lastFrameTime = null;
function animate(time) {
  requestAnimationFrame(animate);

  const dt = lastFrameTime !== null ? (time - lastFrameTime) / 1000 : 0;
  lastFrameTime = time;
  fieldVariable.material.uniforms.uDt.value = dt;

  updateTapInjection();

  gpuCompute.compute();
  displayMaterial.uniforms.uFieldTexture.value = gpuCompute.getCurrentRenderTarget(fieldVariable).texture;
  renderer.render(scene, camera);

  frameCount += 1;
  // compute frameが回っているかをErudaで確認するための間引きログ
  if (frameCount <= 5 || frameCount % 180 === 0) {
    log('frame', frameCount, 'pointerActive=', fieldVariable.material.uniforms.uPointerActive.value);
  }
}
animate();
