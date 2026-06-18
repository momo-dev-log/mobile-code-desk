/* =========================================================================
 * 感触装置 v0.1.2 PR-A — WebGL field 最小検証
 *
 * 目的: 粒子方式(feel-device/)とは別に、Three.js + GPUComputationRenderer
 *       によるfield方式がスマホで成立するか（黒画面にならず、入る/残る/
 *       薄まるが見えるか）だけを確認する。美しさ・作風調整はまだしない。
 *
 * やること: WebGL renderer, dye field (HalfFloatType, 128x128, NEAREST),
 *           pointer/touchのsplat入力, 毎フレームcompute, Eruda経由のログ。
 * やらないこと: velocity/advection/pressure/curl/bloom/UI/保存復元/プリセット。
 * ========================================================================= */

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import {
  DYE_RESOLUTION,
  dyeComputeShader,
  displayVertexShader,
  displayFragmentShader,
} from './shaders.js?v=2';

const TAG = '[feel-device-field]';
const log = (...args) => console.log(TAG, ...args);
const logError = (...args) => console.error(TAG, ...args);

// コードを変えるたびに、このBUILDとindex.html側の?v=Nを必ずセットで上げる。
// 画面のHUDに出る番号と読み込んでいる番号が一致して初めて「反映された」と確信できる。
const BUILD = 'v4';

// 校正用の最低限の数値。美しさはまだ調整しない。
const PARAMS = {
  splatRadius: 0.045,   // splatの広がり（uv空間、0〜1）
  splatStrength: 0.55,  // 1フレームあたりの濃さの加算量
  dissipation: 0.985,   // 毎フレームdyeに掛ける減衰率（小さいほど早く薄まる）
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

// ── GPUComputationRenderer: dye field を1つだけ持つ ──
const gpuCompute = new GPUComputationRenderer(DYE_RESOLUTION, DYE_RESOLUTION, renderer);
// dataTypeはHalfFloatTypeを無条件で指定する（PR-Aの技術方針）
gpuCompute.setDataType(THREE.HalfFloatType);
log(`GPUComputationRenderer 作成. resolution=${DYE_RESOLUTION}x${DYE_RESOLUTION} dataType=HalfFloatType`);

const dyeTexture = gpuCompute.createTexture();
log('初期dyeテクスチャ作成OK (ゼロ初期化)');

const dyeVariable = gpuCompute.addVariable('textureDye', dyeComputeShader, dyeTexture);
gpuCompute.setVariableDependencies(dyeVariable, [dyeVariable]);

// filterはNEARESTから開始（明示的に指定する。デフォルトもNEARESTだが意図を残す）
dyeVariable.minFilter = THREE.NearestFilter;
dyeVariable.magFilter = THREE.NearestFilter;

dyeVariable.material.uniforms.uPointer = { value: new THREE.Vector2(0.5, 0.5) };
dyeVariable.material.uniforms.uPointerActive = { value: 0 };
dyeVariable.material.uniforms.uRadius = { value: PARAMS.splatRadius };
dyeVariable.material.uniforms.uStrength = { value: PARAMS.splatStrength };
dyeVariable.material.uniforms.uDissipation = { value: PARAMS.dissipation };
log('dye variable 作成OK. filter=NEAREST');

const initError = gpuCompute.init();
if (initError !== null) {
  logError('GPUComputationRenderer.init() 失敗:', initError);
} else {
  log('GPUComputationRenderer.init() OK');
}

// PR-A.1: NEAREST → Linear。128x128を画面サイズへ拡大表示するときの
// ブロック状の階段を補間で滑らかにする（入る/残る/薄まるの挙動は変えない）。
// half float + linearはWebGL2ならコアで使えるが、WebGL1ではOES_texture_half_float_linear
// 拡張が無いと効かずテクスチャがincompleteになり黒画面になる。USE_LINEARを
// falseに戻すだけでNEARESTへ復帰できるようにしておく。
const USE_LINEAR = true; // 黒画面になったらfalseに戻す（NEARESTへ）
const dyeFilter = USE_LINEAR ? THREE.LinearFilter : THREE.NearestFilter;
// dye variable（前フレームを引き継ぐcompute変数）のping-pong用ターゲット2枚に設定する。
// displayパスは同じテクスチャを参照しているので、表示側にも自動で効く。
dyeVariable.renderTargets.forEach((rt) => {
  rt.texture.minFilter = dyeFilter;
  rt.texture.magFilter = dyeFilter;
});

const gl = renderer.getContext();
const linearUsable = renderer.capabilities.isWebGL2
  ? true // WebGL2のhalf floatはlinearがコアで使える
  : !!gl.getExtension('OES_texture_half_float_linear');
log('[7] linear filter usable?', linearUsable, '/ USE_LINEAR =', USE_LINEAR);

// Erudaを開かずに反映状況を確認できるよう、画面左下のHUDに状態を出す。
const hud = document.getElementById('hud');
hud.textContent =
  `${BUILD} | ${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} | linear:${(USE_LINEAR && linearUsable) ? 'ON' : 'OFF'}`;

// ── 表示用シーン: フルスクリーン1枚のPlaneにdyeをそのまま映す ──
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const displayMaterial = new THREE.ShaderMaterial({
  vertexShader: displayVertexShader,
  fragmentShader: displayFragmentShader,
  uniforms: {
    uDyeTexture: { value: null },
    uBgColor: { value: new THREE.Vector3(0.97, 0.97, 0.95) },
    uInkColor: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
  },
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial));

// ── pointer / touch 入力 ──
// 1本指のみ追跡。前回位置との補間はせず、現在位置をそのままsplat中心に使う。
let activePointerId = null;

function setPointerUv(clientX, clientY) {
  const uv = dyeVariable.material.uniforms.uPointer.value;
  uv.x = clientX / window.innerWidth;
  uv.y = 1 - clientY / window.innerHeight; // gl_FragCoord/vUvはy=0が下のため反転
}

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  setPointerUv(e.clientX, e.clientY);
  dyeVariable.material.uniforms.uPointerActive.value = 1;
  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  log('pointerdown', e.pointerType, e.clientX.toFixed(1), e.clientY.toFixed(1));
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  setPointerUv(e.clientX, e.clientY);
  e.preventDefault();
}, { passive: false });

function release(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  dyeVariable.material.uniforms.uPointerActive.value = 0;
  log('pointerup/cancel', e.pointerType);
  e.preventDefault();
}
canvas.addEventListener('pointerup', release, { passive: false });
canvas.addEventListener('pointercancel', release, { passive: false });

// ── メインループ ──
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);

  gpuCompute.compute();
  displayMaterial.uniforms.uDyeTexture.value = gpuCompute.getCurrentRenderTarget(dyeVariable).texture;
  renderer.render(scene, camera);

  frameCount += 1;
  // compute frameが回っているかをErudaで確認するための間引きログ
  if (frameCount <= 5 || frameCount % 180 === 0) {
    log('frame', frameCount, 'pointerActive=', dyeVariable.material.uniforms.uPointerActive.value);
  }
}
animate();
