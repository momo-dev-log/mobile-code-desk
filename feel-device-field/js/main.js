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

// 校正用の最低限の数値。美しさはまだ調整しない。
const PARAMS = {
  splatRadius: 0.045,   // splatの広がり（uv空間、0〜1）
  splatStrength: 0.55,  // 1フレームあたりの濃さの加算量
  dissipation: 0.985,   // 毎フレームdyeに掛ける減衰率（小さいほど早く薄まる）
};

// PR-B.1: 遅延splat（lag injection）用の最低限の数値。美しさはまだ調整しない。
const LAG_PARAMS = {
  k: 0.08,          // 60fps基準の追従量（1フレームで残り距離を詰める割合）
  minMoveUv: 0.0015, // lagPosが前回splat位置からこの距離(uv空間)以上動いた時だけ新規splatを入れる
};

// PR-C.1a: 見た目として成立するか確認するため、drift強度のみ調整。
// driftFieldの形/空間スケール/時間変化量は変更しない。
const DRIFT_PARAMS = {
  strength: 0.04, // UV/秒。dyeのサンプリング位置をdissipation/splatより前にずらす強さ
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
dyeVariable.material.uniforms.uTime = { value: 0 };
dyeVariable.material.uniforms.uDt = { value: 0 };
dyeVariable.material.uniforms.uDriftStrength = { value: DRIFT_PARAMS.strength };
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
  `${BUILD} | ${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} | linear:${(USE_LINEAR && linearUsable) ? 'ON' : 'OFF'} | lag:${LAG_PARAMS.k} | drift:${DRIFT_PARAMS.strength}`;

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
// PR-B.1: 指の実位置(fingerUv)とは別に、遅れて追従する位置(lagUv)を持つ。
// splatはfingerUvではなくlagUvに対して入れる。「ついてこない/遅れる/
// 引きずる」をfield方式で確認するための最小実装。
// 1本指のみ追跡。
let activePointerId = null;
const fingerUv = new THREE.Vector2(0.5, 0.5);
const lagUv = new THREE.Vector2(0.5, 0.5);
const lastInjectedUv = new THREE.Vector2(0.5, 0.5);
let pendingInitialSplat = false; // pointerdown直後の1回だけ、しきい値判定を素通りさせる
let lastLagTime = null;

function clientToUv(clientX, clientY) {
  return new THREE.Vector2(
    clientX / window.innerWidth,
    1 - clientY / window.innerHeight, // gl_FragCoord/vUvはy=0が下のため反転
  );
}

function setSplatUv(uv) {
  const target = dyeVariable.material.uniforms.uPointer.value;
  target.x = uv.x;
  target.y = uv.y;
}

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  fingerUv.copy(clientToUv(e.clientX, e.clientY));
  pendingInitialSplat = true; // fingerUv/lagUvの初期化とその場への1回splatはRAF側で行う
  lastLagTime = null;
  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  log('pointerdown', e.pointerType, e.clientX.toFixed(1), e.clientY.toFixed(1));
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activePointerId) return;
  // fingerUvのみ更新する。ここでは直接splatしない（lagUvがRAF側で追従する）。
  fingerUv.copy(clientToUv(e.clientX, e.clientY));
  e.preventDefault();
}, { passive: false });

function release(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  pendingInitialSplat = false;
  dyeVariable.material.uniforms.uPointerActive.value = 0; // 注入を即停止する
  log('pointerup/cancel', e.pointerType);
  e.preventDefault();
}
canvas.addEventListener('pointerup', release, { passive: false });
canvas.addEventListener('pointercancel', release, { passive: false });

// 指を押している間だけ呼ばれる。lagUvをfingerUvへフレームレート非依存で
// 追従させ、前回splat位置から十分動いた時だけ新規splatを入れる。
function updateLagAndSplat(time) {
  if (activePointerId === null) {
    dyeVariable.material.uniforms.uPointerActive.value = 0;
    return;
  }

  if (pendingInitialSplat) {
    lagUv.copy(fingerUv);
    lastInjectedUv.copy(fingerUv);
    setSplatUv(fingerUv);
    dyeVariable.material.uniforms.uPointerActive.value = 1;
    pendingInitialSplat = false;
    lastLagTime = time;
    return;
  }

  const dt = lastLagTime !== null ? (time - lastLagTime) / 1000 : 0;
  lastLagTime = time;

  if (dt > 0) {
    // k=0.08は60fps基準。dtベースの減衰係数に変換し、120Hz等でも
    // 実時間あたりの追従速度がほぼ変わらないようにする。
    const factor = 1 - Math.pow(1 - LAG_PARAMS.k, dt * 60);
    lagUv.x += (fingerUv.x - lagUv.x) * factor;
    lagUv.y += (fingerUv.y - lagUv.y) * factor;
  }

  if (lagUv.distanceTo(lastInjectedUv) > LAG_PARAMS.minMoveUv) {
    setSplatUv(lagUv);
    lastInjectedUv.copy(lagUv);
    dyeVariable.material.uniforms.uPointerActive.value = 1;
  } else {
    dyeVariable.material.uniforms.uPointerActive.value = 0;
  }
}

// ── メインループ ──
let frameCount = 0;
// PR-C.1: drift用のuTime/uDt。lastLagTimeとは別に持つ（lastLagTimeは指を
// 押している間だけ進むが、driftは指の有無に関わらず毎フレーム進める）。
let lastFrameTime = null;
function animate(time) {
  requestAnimationFrame(animate);

  const driftDt = lastFrameTime !== null ? (time - lastFrameTime) / 1000 : 0;
  lastFrameTime = time;
  dyeVariable.material.uniforms.uTime.value = time / 1000;
  dyeVariable.material.uniforms.uDt.value = driftDt;

  updateLagAndSplat(time);

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
