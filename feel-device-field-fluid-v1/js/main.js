/* =========================================================================
 * 感触装置 — fluid v1 (独立ページ)
 *
 * このページのsolver(velocity advection / divergence / pressure Jacobi /
 * gradient subtract、FBO ping-pong、WebGL1/2・half float判定、resize時の
 * resample)は、下記オリジナルのMITライセンス条件のもとで再配布される
 * PavelDoGreat/WebGL-Fluid-Simulation の構成を土台にしている。
 * curl・vorticity confinement・bloom・sunrays・colorful dye・pointer位置への
 * dye splat・multipleSplats・particle等は採用していない。
 *
 * -------------------------------------------------------------------------
 * MIT License
 *
 * Copyright (c) 2017 Pavel Dobryakov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Original repository: https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 * -------------------------------------------------------------------------
 *
 * v1で検証する一点: 指のswipeがvelocityへ抑制された力として入り、起動時から
 * 存在するtracer(R)がそのvelocityで運ばれて歪み、release後は新規入力なしに
 * 既存の場だけが自律的に収まること。tapは無反応。tracerへの直接書き込みは
 * pointerからは一切行わない。
 * ========================================================================= */

import {
  baseVertexShader,
  copyShader,
  clearShader,
  splatShader,
  divergenceShader,
  pressureShader,
  gradientSubtractShader,
  advectionShader,
  initTracerShader,
  displayShader,
} from './shaders.js?v=unbuilt';

const TAG = '[feel-device-field-fluid-v1]';
const log = (...args) => console.log(TAG, ...args);
const logError = (...args) => console.error(TAG, ...args);

// この 'build:unbuilt' は .github/workflows/deploy-pages.yml がstaging artifact
// 内だけで実際のGITHUB_SHA短縮値に書き換える置き換え対象。手で書き換えない。
const BUILD = 'build:unbuilt';

// 採用根拠・概算はPR本文に記載。
const PARAMS = {
  simResolution: 128,          // velocity/divergence/pressureの解像度(正方形)
  tracerResolution: 512,       // tracerの解像度(simより高く、流れの歪みを滑らかに見せる)
  pressureIterations: 20,      // 実機で破綻しない最小限として採用(前例の標準値と同じ)
  pressureWarmStart: 0.8,      // 前回pressureを0.8倍してから次のJacobi反復の初期値にする(warm start)
  tapThresholdUv: 0.02,        // この累積移動量(UV)を超えるまではtap=無反応
  forceRadiusUv: 0.05,         // splatのガウシアン半径(UV)
  forceMax: 6.0,               // 1回のsplatで加える力の上限
  forceLowpassK: 0.35,         // 60fps基準の力lowpassの混合係数(0〜1)
  speedLow: 0.15,              // この速度(UV/s)以下では力はほぼ0
  speedHigh: 2.5,              // この速度(UV/s)以上で力は上限(forceMax)に達する
  velocityDissipationDecay60: 0.985, // 60fps基準のvelocity減衰倍率
  tracerDissipationDecay60: 1.0,     // tracerは常在fieldなので散逸させない(意図的に1.0)
  tracerSeed: 91.731,
  tracerFrequency: 2.5,
  tracerAmplitude: 0.18,
  tracerBaseline: 0.5,
  displayContrastGain: 2.2,
};

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const resetButton = document.getElementById('reset');

// ── WebGL context + 拡張機能の判定(前例のgetWebGLContextと同じ考え方) ──
function getWebGLContext(targetCanvas) {
  const params = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

  let gl = targetCanvas.getContext('webgl2', params);
  const isWebGL2 = !!gl;
  if (!isWebGL2) {
    gl = targetCanvas.getContext('webgl', params) || targetCanvas.getContext('experimental-webgl', params);
  }
  if (!gl) {
    throw new Error('WebGLコンテキストの取得に失敗');
  }

  let halfFloat;
  let supportLinearFiltering;
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float');
    supportLinearFiltering = !!gl.getExtension('OES_texture_float_linear');
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float');
    supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear');
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);

  let formatRGBA;
  let formatRG;
  let formatR;
  if (isWebGL2) {
    formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
    formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
    formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
  } else {
    formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    formatRG = formatRGBA;
    formatR = formatRGBA;
  }

  return {
    gl,
    isWebGL2,
    ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering },
  };
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      default:
        return null;
    }
  }
  return { internalFormat, format };
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  return status === gl.FRAMEBUFFER_COMPLETE;
}

let gl;
let isWebGL2;
let ext;
try {
  const ctx = getWebGLContext(canvas);
  gl = ctx.gl;
  isWebGL2 = ctx.isWebGL2;
  ext = ctx.ext;
} catch (e) {
  logError('WebGLコンテキストの取得に失敗', e);
  throw e;
}
log('WebGLコンテキスト取得OK. isWebGL2 =', isWebGL2, 'supportLinearFiltering =', ext.supportLinearFiltering);

// ── shaderコンパイル/program作成ヘルパー ──
function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    logError('shaderコンパイル失敗', gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    logError('programリンク失敗', gl.getProgramInfoLog(program));
  }
  return program;
}

function getUniforms(program) {
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return uniforms;
}

class Program {
  constructor(vertexSource, fragmentSource) {
    this.program = createProgram(vertexSource, fragmentSource);
    this.uniforms = getUniforms(this.program);
  }

  bind() {
    gl.useProgram(this.program);
  }
}

const copyProgram = new Program(baseVertexShader, copyShader);
const clearProgram = new Program(baseVertexShader, clearShader);
const splatProgram = new Program(baseVertexShader, splatShader);
const divergenceProgram = new Program(baseVertexShader, divergenceShader);
const pressureProgram = new Program(baseVertexShader, pressureShader);
const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
const advectionProgram = new Program(baseVertexShader, advectionShader);
const initTracerProgram = new Program(baseVertexShader, initTracerShader);
const displayProgram = new Program(baseVertexShader, displayShader);
log('全program作成OK(curl/vorticity/bloom/sunrays系のprogramは無し)');

// ── fullscreen quad blit ──
const blit = (() => {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const elementBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  return (target) => {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
})();

function getResolution(resolution) {
  let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
  if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
  const min = Math.round(resolution);
  const max = Math.round(resolution * aspectRatio);
  if (gl.drawingBufferWidth > gl.drawingBufferHeight) {
    return { width: max, height: min };
  }
  return { width: min, height: max };
}

function createFBO(w, h, internalFormat, format, type, param) {
  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const texelSizeX = 1.0 / w;
  const texelSizeY = 1.0 / h;
  return {
    texture,
    fbo,
    width: w,
    height: h,
    texelSizeX,
    texelSizeY,
    attach(id) {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return id;
    },
  };
}

function createDoubleFBO(w, h, internalFormat, format, type, param) {
  let fbo1 = createFBO(w, h, internalFormat, format, type, param);
  let fbo2 = createFBO(w, h, internalFormat, format, type, param);
  return {
    width: w,
    height: h,
    texelSizeX: fbo1.texelSizeX,
    texelSizeY: fbo1.texelSizeY,
    get read() { return fbo1; },
    set read(value) { fbo1 = value; },
    get write() { return fbo2; },
    set write(value) { fbo2 = value; },
    swap() {
      const temp = fbo1;
      fbo1 = fbo2;
      fbo2 = temp;
    },
  };
}

// 既存内容をcopyShaderで新解像度へblitしながら作り直す(前例のresizeFBOと同じ考え方)。
function resizeFBO(target, w, h, internalFormat, format, type, param) {
  const newFBO = createFBO(w, h, internalFormat, format, type, param);
  copyProgram.bind();
  gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
  blit(newFBO);
  return newFBO;
}

function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
  if (target.width === w && target.height === h) return target;
  target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
  target.write = createFBO(w, h, internalFormat, format, type, param);
  target.width = w;
  target.height = h;
  target.texelSizeX = 1.0 / w;
  target.texelSizeY = 1.0 / h;
  return target;
}

// ── framebuffer群 ──
let velocity;
let divergence;
let pressure;
let tracer;
let tracerInitialized = false;

function clearFBOToZero(fbo) {
  clearProgram.bind();
  gl.uniform1i(clearProgram.uniforms.uTexture, fbo.read.attach(0));
  gl.uniform1f(clearProgram.uniforms.value, 0.0);
  blit(fbo.write);
  fbo.swap();
}

function seedTracer() {
  initTracerProgram.bind();
  gl.uniform1f(initTracerProgram.uniforms.uSeed, PARAMS.tracerSeed);
  gl.uniform1f(initTracerProgram.uniforms.uFrequency, PARAMS.tracerFrequency);
  gl.uniform1f(initTracerProgram.uniforms.uAmplitude, PARAMS.tracerAmplitude);
  gl.uniform1f(initTracerProgram.uniforms.uBaseline, PARAMS.tracerBaseline);
  blit(tracer.write);
  tracer.swap();
  blit(tracer.write);
  tracer.swap();
  log('tracer初期分布を生成(固定seed low-frequency noise)');
}

function initFramebuffers() {
  const simRes = getResolution(PARAMS.simResolution);
  const tracerRes = getResolution(PARAMS.tracerResolution);
  const texType = ext.halfFloatTexType;
  const rg = ext.formatRG;
  const r = ext.formatR;
  const rgba = ext.formatRGBA;
  const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

  if (!velocity) {
    velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
  } else {
    velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
  }

  if (!divergence) {
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  } else if (divergence.width !== simRes.width || divergence.height !== simRes.height) {
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  if (!pressure) {
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  } else {
    pressure = resizeDoubleFBO(pressure, simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  if (!tracer) {
    tracer = createDoubleFBO(tracerRes.width, tracerRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    seedTracer();
    tracerInitialized = true;
  } else {
    tracer = resizeDoubleFBO(tracer, tracerRes.width, tracerRes.height, rgba.internalFormat, rgba.format, texType, filtering);
  }

  if (!tracerInitialized) {
    seedTracer();
    tracerInitialized = true;
  }
}

// Resetボタン: tracerを起動時と同じ初期分布へ戻し、velocity/pressure/divergenceも
// ゼロへ戻す(「場をやり直す」操作として、tracerだけでなくvelocityも初期化する)。
function resetAll() {
  clearFBOToZero(velocity);
  clearFBOToZero(pressure);
  gl.viewport(0, 0, divergence.width, divergence.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, divergence.fbo);
  gl.clear(gl.COLOR_BUFFER_BIT);
  seedTracer();
  log('Reset実行: velocity/pressure/divergenceをゼロ化、tracerを初期分布へ');
}

if (resetButton) {
  resetButton.addEventListener('click', () => {
    resetAll();
  });
}

// ── pointer入力: tap非反応、swipeのみ反応、release時に全状態を破棄 ──
const pointerState = {
  id: null,
  down: false,
  pastTapThreshold: false,
  curUv: { x: 0.5, y: 0.5 },
  totalMoveUv: 0,
  hasFreshMove: false,
  rawDeltaX: 0,
  rawDeltaY: 0,
  filteredForceX: 0,
  filteredForceY: 0,
};

function resetPointerState() {
  pointerState.id = null;
  pointerState.down = false;
  pointerState.pastTapThreshold = false;
  pointerState.totalMoveUv = 0;
  pointerState.hasFreshMove = false;
  pointerState.rawDeltaX = 0;
  pointerState.rawDeltaY = 0;
  pointerState.filteredForceX = 0;
  pointerState.filteredForceY = 0;
}
resetPointerState();

function clientToUv(clientX, clientY) {
  return {
    x: clientX / window.innerWidth,
    y: 1 - clientY / window.innerHeight, // vUvはy=0が下のため反転
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (pointerState.down) return;
  resetPointerState();
  pointerState.id = e.pointerId;
  pointerState.down = true;
  const uv = clientToUv(e.clientX, e.clientY);
  pointerState.curUv = uv;

  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  log('pointerdown', e.pointerType, uv.x.toFixed(3), uv.y.toFixed(3));
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (!pointerState.down || e.pointerId !== pointerState.id) return;

  const uv = clientToUv(e.clientX, e.clientY);
  const dx = uv.x - pointerState.curUv.x;
  const dy = uv.y - pointerState.curUv.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  pointerState.totalMoveUv += dist;

  if (!pointerState.pastTapThreshold && pointerState.totalMoveUv > PARAMS.tapThresholdUv) {
    pointerState.pastTapThreshold = true;
    log('tap閾値を超過。swipe入力として力の計算を開始');
  }

  pointerState.curUv = uv;

  // tap閾値を超えるまではfieldへ何も注入しない(位置/距離の追跡だけ行う)。
  if (pointerState.pastTapThreshold) {
    pointerState.rawDeltaX = dx;
    pointerState.rawDeltaY = dy;
    pointerState.hasFreshMove = true;
  }
  e.preventDefault();
}, { passive: false });

function release(e) {
  if (e.pointerId !== pointerState.id) return;
  log('pointerup/cancel', e.pointerType, '— pointer由来の状態を全破棄');
  resetPointerState();
  e.preventDefault();
}
canvas.addEventListener('pointerup', release, { passive: false });
canvas.addEventListener('pointercancel', release, { passive: false });

// 指の動きを「そのままの力」にせず、lowpass→速度マップ→上限clampを通す。
// pointerup後はpointerState.downがfalseになっているため、この関数はnullを返し、
// 以後どのフレームでも力は生成されない(=遅延注入は起きない)。
function computeFrameForce(dt) {
  if (!pointerState.down || !pointerState.pastTapThreshold) return null;

  // dt異常(タブのバックグラウンド復帰等の大きな飛び)はこのフレームの動きを
  // 無視して、力が跳ねるのを防ぐ。
  const dtValid = dt > 0 && dt <= 0.05;

  let targetX = 0;
  let targetY = 0;
  if (dtValid && pointerState.hasFreshMove) {
    targetX = pointerState.rawDeltaX / dt;
    targetY = pointerState.rawDeltaY / dt;
  }
  pointerState.hasFreshMove = false;
  pointerState.rawDeltaX = 0;
  pointerState.rawDeltaY = 0;

  // lowpass: 60fps基準の混合係数をdt補正してから、現フレームのtarget力へ寄せる。
  const lowpassFactor = 1.0 - Math.pow(1.0 - PARAMS.forceLowpassK, Math.max(dt, 0) * 60.0);
  pointerState.filteredForceX += (targetX - pointerState.filteredForceX) * lowpassFactor;
  pointerState.filteredForceY += (targetY - pointerState.filteredForceY) * lowpassFactor;

  const speed = Math.sqrt(
    pointerState.filteredForceX * pointerState.filteredForceX +
    pointerState.filteredForceY * pointerState.filteredForceY,
  );
  if (speed < 1e-5) return null;

  // 速度→力の抑制的なマップ(smoothstep)。speedLow以下は0、speedHigh以上はforceMax。
  const t = Math.min(Math.max((speed - PARAMS.speedLow) / (PARAMS.speedHigh - PARAMS.speedLow), 0), 1);
  const mapped = t * t * (3.0 - 2.0 * t);
  const magnitude = Math.min(mapped * PARAMS.forceMax, PARAMS.forceMax); // 念のための明示的clamp

  if (magnitude < 1e-5) return null;

  const nx = pointerState.filteredForceX / speed;
  const ny = pointerState.filteredForceY / speed;

  return {
    x: pointerState.curUv.x,
    y: pointerState.curUv.y,
    forceX: nx * magnitude,
    forceY: ny * magnitude,
  };
}

function splatForce(x, y, forceX, forceY) {
  splatProgram.bind();
  gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
  gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
  gl.uniform2f(splatProgram.uniforms.point, x, y);
  gl.uniform2f(splatProgram.uniforms.force, forceX, forceY);
  gl.uniform1f(splatProgram.uniforms.radius, PARAMS.forceRadiusUv);
  blit(velocity.write);
  velocity.swap();
}

// ── solver 1ステップ ──
const manualFiltering = ext.supportLinearFiltering ? 0.0 : 1.0;

function step(dt) {
  gl.disable(gl.BLEND);

  // divergence
  gl.viewport(0, 0, divergence.width, divergence.height);
  divergenceProgram.bind();
  gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
  blit(divergence);

  // pressure warm start(前回のpressureを減衰させてから次の反復の初期値にする)
  gl.viewport(0, 0, pressure.width, pressure.height);
  clearProgram.bind();
  gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
  gl.uniform1f(clearProgram.uniforms.value, PARAMS.pressureWarmStart);
  blit(pressure.write);
  pressure.swap();

  // pressure Jacobi反復
  pressureProgram.bind();
  gl.uniform2f(pressureProgram.uniforms.texelSize, pressure.texelSizeX, pressure.texelSizeY);
  gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
  for (let i = 0; i < PARAMS.pressureIterations; i++) {
    gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
    blit(pressure.write);
    pressure.swap();
  }

  // gradient subtract(projection)
  gl.viewport(0, 0, velocity.width, velocity.height);
  gradientSubtractProgram.bind();
  gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
  gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
  blit(velocity.write);
  velocity.swap();

  // velocity自己移流 + velocity dissipation
  advectionProgram.bind();
  gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1f(advectionProgram.uniforms.uManualFiltering, manualFiltering);
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
  gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0));
  gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1f(advectionProgram.uniforms.dt, dt);
  gl.uniform1f(advectionProgram.uniforms.dissipation, Math.pow(PARAMS.velocityDissipationDecay60, dt * 60.0));
  blit(velocity.write);
  velocity.swap();

  // tracer移流(更新済みvelocityで運ぶ) + tracer dissipation(=1.0なので実質無し)
  gl.viewport(0, 0, tracer.width, tracer.height);
  gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
  gl.uniform1i(advectionProgram.uniforms.uSource, tracer.read.attach(1));
  gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, tracer.texelSizeX, tracer.texelSizeY);
  gl.uniform1f(advectionProgram.uniforms.dissipation, Math.pow(PARAMS.tracerDissipationDecay60, dt * 60.0));
  blit(tracer.write);
  tracer.swap();
}

function render() {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  displayProgram.bind();
  gl.uniform1i(displayProgram.uniforms.uTracer, tracer.read.attach(0));
  gl.uniform1f(displayProgram.uniforms.uContrastGain, PARAMS.displayContrastGain);
  gl.uniform3f(displayProgram.uniforms.uBgColor, 0.12, 0.12, 0.12);
  gl.uniform3f(displayProgram.uniforms.uFgColor, 0.92, 0.92, 0.92);
  blit(null);
}

function resizeCanvasIfNeeded() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(canvas.clientWidth * dpr);
  const targetHeight = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    return true;
  }
  return false;
}

initFramebuffers();
hud.textContent = `${BUILD} | fluid-v1 | velocity:ON | pressure:ON | tracer:R | input:swipe`;

// ── メインループ ──
let lastFrameTime = null;
let frameCount = 0;
function animate(time) {
  requestAnimationFrame(animate);

  let dt = lastFrameTime !== null ? (time - lastFrameTime) / 1000 : 0;
  lastFrameTime = time;
  dt = Math.min(dt, 0.05);

  if (resizeCanvasIfNeeded()) {
    initFramebuffers(); // 既存内容をresample。再初期化(再シード)はしない
  }

  const force = computeFrameForce(dt);
  if (force) {
    splatForce(force.x, force.y, force.forceX, force.forceY);
  }

  step(dt);
  render();

  frameCount += 1;
  if (frameCount <= 5 || frameCount % 180 === 0) {
    log('frame', frameCount, 'down=', pointerState.down, 'pastTapThreshold=', pointerState.pastTapThreshold);
  }
}
animate();
