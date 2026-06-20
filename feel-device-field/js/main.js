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
  k: 0.08,          // 60fps基準の追従量（1フレームで残り距離を詰める割合）。動き始めの遷移完了後の通常値
  minMoveUv: 0.0015, // lagPosが前回splat位置からこの距離(uv空間)以上動いた時だけ新規splatを入れる
};

// PR-B.2: lagの立ち上がり緩和（onset）用の最低限の数値。美しさはまだ調整しない。
const LAG_ONSET_PARAMS = {
  kOnset: 0.16,          // 動き始め直後だけのk(60fps基準)。LAG_PARAMS.kへ滑らかに遷移する
  transitionFrac: 0.08,  // 画面短辺に対する比率。この距離だけ実際に動いたらk:0.16→0.08の遷移が完了する(初期値)
  resetGapMs: 120,       // 意味のある移動がこの時間(ms)以上無ければ、次の移動を新しい動き始めとして扱う
  meaningfulMoveFrac: 0.01, // 画面短辺に対する比率。これ未満の移動はタッチ揺れとして無視する(リセット判定にも使わない)
};

// PR-D.1: C.1のdriftはOFFにする。driftField自体は削除せず、
// uDriftStrength=0で無効化するだけにとどめる（uDt倍されるためdriftOffsetは常にゼロになる）。
const DRIFT_PARAMS = {
  strength: 0,
};

// PR-D.1: diffusion / edge relaxation用の最低限の数値。
// 中心と上下左右4近傍の平均を、この係数でごく少量だけmixする。60fps基準。
const SOFTEN_PARAMS = {
  strength: 0.03,
};

// PR-seq: 速いstrokeだけ、pointerup後に始点→終点の順で少し遅れて解放するための
// 最低限の数値。描画中の挙動(lag/soften/drift/通常dissipation)には一切関与しない。
const RELEASE_PARAMS = {
  speedLow: 0.35,            // 短辺比/秒。これ以下のstrokeはassist=0(無介入)
  speedHigh: 1.10,           // 短辺比/秒。これ以上でassist=assistMaxへ漸近
  assistMax: 0.60,           // assistの最大値。1.0相当(明確なワイプ)は使わない
  minReleaseDistance: 0.04,  // 短辺比。stroke全体の距離がこれ未満ならtap等とみなしassist=0
  durationMs: 600,           // pointerup後、release frontがstroke全体を進む実時間
  holdDissipationStrong: 0.999, // 60fps基準。front未到達部分にuReleaseAssistでmixする強い保持値
  meaningfulMoveFrac: 0.01,  // 短辺比。速度計測でジッターとして無視する移動量(onsetとは独立)
  stallGapMs: 120,           // これを超える移動間隔は一時停止とみなし、速度計測の経過時間に加算しない
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
dyeVariable.material.uniforms.uSoftenStrength = { value: SOFTEN_PARAMS.strength };
dyeVariable.material.uniforms.uReleaseEpoch = { value: 0 };
dyeVariable.material.uniforms.uReleaseFront = { value: 0 };
dyeVariable.material.uniforms.uReleaseAssist = { value: 0 };
dyeVariable.material.uniforms.uHoldDissipationStrong = { value: RELEASE_PARAMS.holdDissipationStrong };
dyeVariable.material.uniforms.uStrokeEpoch = { value: 0 };
dyeVariable.material.uniforms.uStrokeDistance = { value: 0 };
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
  `${BUILD} | ${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} | linear:${(USE_LINEAR && linearUsable) ? 'ON' : 'OFF'} | lag:${LAG_ONSET_PARAMS.kOnset}→${LAG_PARAMS.k} | drift:OFF | soften:${SOFTEN_PARAMS.strength} | seq:${RELEASE_PARAMS.assistMax.toFixed(2)}/${RELEASE_PARAMS.durationMs}ms`;

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

// PR-B.2: lagの立ち上がり緩和（onset）用の状態。fingerUv/lagUvとは別に、
// 「直近の動き始め」からの実移動距離(画面短辺比)だけを別途追跡する。
let lastFingerClientPos = null;
let onsetDistanceFrac = 0;
let lastMeaningfulMoveTime = null;

// PR-seq: 速いstrokeだけのpointerup後release補助用の状態。
// lag/onsetの状態(上記)とは完全に独立に保持し、lag処理には一切関与しない。
let strokeEpoch = 0; // pointerdownごとに1..1023でwrapしてインクリメント。0は「strokeなし」予約
let strokeDistanceAccum = 0; // 現strokeのink-trail距離(短辺比)。Gへ記録、release frontの目標値にも使う
let speedDistanceAccum = 0; // 速度計測用の独立した移動距離(短辺比)
let speedActiveDurationMs = 0; // 速度計測用の独立した「実際に動いていた時間」(一時停止は除く)
let lastMeaningfulMoveTimeForSpeed = null;
let lastFingerClientPosForSpeed = null;
let activeRelease = null; // { epoch, totalDistance, assist, startTime } | null

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

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// 直近の動き始めからの累積移動距離(onsetDistanceFrac)に応じて、
// k:0.16→0.08をsmoothstepで連続的に補間する。
function currentLagK() {
  const t = smoothstep(0, LAG_ONSET_PARAMS.transitionFrac, onsetDistanceFrac);
  return LAG_ONSET_PARAMS.kOnset + (LAG_PARAMS.k - LAG_ONSET_PARAMS.kOnset) * t;
}

canvas.addEventListener('pointerdown', (e) => {
  if (activePointerId !== null) return;
  activePointerId = e.pointerId;
  fingerUv.copy(clientToUv(e.clientX, e.clientY));
  pendingInitialSplat = true; // fingerUv/lagUvの初期化とその場への1回splatはRAF側で行う
  lastLagTime = null;
  // PR-B.2: 指を押した直後は、初速フェーズ(onset)を必ずリセットする。
  lastFingerClientPos = { x: e.clientX, y: e.clientY };
  onsetDistanceFrac = 0;
  lastMeaningfulMoveTime = null;

  // PR-seq: 新しいstrokeを始めるたびにepoch/distance/速度計測をリセットする。
  // 進行中の古いreleaseがあれば中断し、未解放部分は通常dissipationへ即座に戻す。
  strokeEpoch = (strokeEpoch % 1023) + 1;
  strokeDistanceAccum = 0;
  speedDistanceAccum = 0;
  speedActiveDurationMs = 0;
  lastMeaningfulMoveTimeForSpeed = null;
  lastFingerClientPosForSpeed = { x: e.clientX, y: e.clientY };
  activeRelease = null;
  dyeVariable.material.uniforms.uReleaseEpoch.value = 0;

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

  // PR-B.2: onset距離の更新。画面短辺(px)に対する比率で実移動距離を測る
  // （UV距離はx/y毎にwidth/heightで正規化されており短辺比とは異なるため）。
  const shortSidePx = Math.min(window.innerWidth, window.innerHeight);
  if (lastFingerClientPos !== null && shortSidePx > 0) {
    const dxPx = e.clientX - lastFingerClientPos.x;
    const dyPx = e.clientY - lastFingerClientPos.y;
    const stepFrac = Math.hypot(dxPx, dyPx) / shortSidePx;
    if (stepFrac >= LAG_ONSET_PARAMS.meaningfulMoveFrac) {
      // 意味のある移動が約120ms無かった場合は、これを新しい動き始めとして扱う。
      if (lastMeaningfulMoveTime !== null && (e.timeStamp - lastMeaningfulMoveTime) > LAG_ONSET_PARAMS.resetGapMs) {
        onsetDistanceFrac = 0;
      }
      onsetDistanceFrac += stepFrac;
      lastMeaningfulMoveTime = e.timeStamp;
    }
  }
  lastFingerClientPos = { x: e.clientX, y: e.clientY };

  // PR-seq: 速度計測用の独立した距離・時間蓄積（onset/lagの状態には触れない）。
  // 押したまま少し止まっても、その停止時間は経過時間に加算しない(stallGapMs超なら除外)。
  if (lastFingerClientPosForSpeed !== null && shortSidePx > 0) {
    const dxPxSpeed = e.clientX - lastFingerClientPosForSpeed.x;
    const dyPxSpeed = e.clientY - lastFingerClientPosForSpeed.y;
    const stepFracSpeed = Math.hypot(dxPxSpeed, dyPxSpeed) / shortSidePx;
    if (stepFracSpeed >= RELEASE_PARAMS.meaningfulMoveFrac) {
      if (lastMeaningfulMoveTimeForSpeed !== null) {
        const gapMs = e.timeStamp - lastMeaningfulMoveTimeForSpeed;
        if (gapMs <= RELEASE_PARAMS.stallGapMs) {
          speedActiveDurationMs += gapMs;
        }
      }
      speedDistanceAccum += stepFracSpeed;
      lastMeaningfulMoveTimeForSpeed = e.timeStamp;
    }
  }
  lastFingerClientPosForSpeed = { x: e.clientX, y: e.clientY };

  e.preventDefault();
}, { passive: false });

function release(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  pendingInitialSplat = false;
  dyeVariable.material.uniforms.uPointerActive.value = 0; // 注入を即停止する

  // PR-seq: pointerup/cancel時に、直近strokeのassistを一度だけ確定し、
  // release frontを開始する。tap等(距離不足)や遅いstrokeはassist=0のままになり、
  // その場合は以後の挙動が通常のdissipationと完全に同じになる。
  const totalDistance = strokeDistanceAccum;
  let assist = 0;
  if (totalDistance >= RELEASE_PARAMS.minReleaseDistance && speedActiveDurationMs > 0) {
    const avgSpeed = speedDistanceAccum / (speedActiveDurationMs / 1000);
    assist = smoothstep(RELEASE_PARAMS.speedLow, RELEASE_PARAMS.speedHigh, avgSpeed) * RELEASE_PARAMS.assistMax;
  }
  activeRelease = {
    epoch: strokeEpoch,
    totalDistance,
    assist,
    startTime: e.timeStamp,
  };

  log('pointerup/cancel', e.pointerType, 'assist=', assist.toFixed(3), 'totalDistance=', totalDistance.toFixed(3));
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
    // PR-seq: stroke開始地点はdistance=0として記録する。
    dyeVariable.material.uniforms.uStrokeEpoch.value = strokeEpoch;
    dyeVariable.material.uniforms.uStrokeDistance.value = strokeDistanceAccum;
    pendingInitialSplat = false;
    lastLagTime = time;
    return;
  }

  const dt = lastLagTime !== null ? (time - lastLagTime) / 1000 : 0;
  lastLagTime = time;

  if (dt > 0) {
    // PR-B.2: kは固定値ではなく、onsetDistanceFracに応じてkOnset(0.16)から
    // LAG_PARAMS.k(0.08)へsmoothstepで連続的に遷移する値を使う。
    // 60fps基準のkを、dtベースの減衰係数に変換し、120Hz等でも
    // 実時間あたりの追従速度がほぼ変わらないようにする（既存のdt補正を維持）。
    const k = currentLagK();
    const factor = 1 - Math.pow(1 - k, dt * 60);
    lagUv.x += (fingerUv.x - lagUv.x) * factor;
    lagUv.y += (fingerUv.y - lagUv.y) * factor;
  }

  if (lagUv.distanceTo(lastInjectedUv) > LAG_PARAMS.minMoveUv) {
    // PR-seq: 新規splatを入れる直前に、lagUvのink-trail距離(短辺比)を加算し、
    // そのstrokeのepoch/累積distanceをG/B記録用uniformへ反映する。
    // lagUv/factor/minMoveUvの判定条件自体には触れない。
    const shortSidePxForStroke = Math.min(window.innerWidth, window.innerHeight);
    if (shortSidePxForStroke > 0) {
      const dxPxStroke = (lagUv.x - lastInjectedUv.x) * window.innerWidth;
      const dyPxStroke = (lagUv.y - lastInjectedUv.y) * window.innerHeight;
      strokeDistanceAccum += Math.hypot(dxPxStroke, dyPxStroke) / shortSidePxForStroke;
    }
    setSplatUv(lagUv);
    lastInjectedUv.copy(lagUv);
    dyeVariable.material.uniforms.uPointerActive.value = 1;
    dyeVariable.material.uniforms.uStrokeEpoch.value = strokeEpoch;
    dyeVariable.material.uniforms.uStrokeDistance.value = strokeDistanceAccum;
  } else {
    dyeVariable.material.uniforms.uPointerActive.value = 0;
  }
}

// PR-seq: pointerup後、直近strokeのrelease frontをdistance=0から
// totalDistanceまでdurationMsで線形に進める。指の有無に関わらず毎フレーム呼ぶ。
function updateRelease(time) {
  if (activeRelease === null) {
    dyeVariable.material.uniforms.uReleaseEpoch.value = 0;
    return;
  }

  const elapsedMs = time - activeRelease.startTime;
  if (elapsedMs >= RELEASE_PARAMS.durationMs) {
    activeRelease = null;
    dyeVariable.material.uniforms.uReleaseEpoch.value = 0;
    return;
  }

  const t = elapsedMs / RELEASE_PARAMS.durationMs;
  dyeVariable.material.uniforms.uReleaseEpoch.value = activeRelease.epoch;
  dyeVariable.material.uniforms.uReleaseFront.value = activeRelease.totalDistance * t;
  dyeVariable.material.uniforms.uReleaseAssist.value = activeRelease.assist;
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
  updateRelease(time);

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
