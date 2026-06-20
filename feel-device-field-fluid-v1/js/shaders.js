/* =========================================================================
 * 感触装置 — fluid v1 (独立ページ)
 *
 * このファイルのGLSLは PavelDoGreat/WebGL-Fluid-Simulation
 * (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation, MIT License) の
 * Stable Fluids solver構成(advection / divergence / pressure Jacobi /
 * gradient subtract)を土台にしている。curl・vorticity confinement・
 * bloom・sunrays・colorful dye・pointer位置へのdye splatは採用していない。
 *
 * ライセンス全文は js/main.js の先頭コメントに保持している。
 * ========================================================================= */

// 全パス共通の頂点シェーダ。fullscreen quadを描き、上下左右の隣接texelの
// UVをvarying経由で事前計算する(divergence/pressure/gradientSubtractで使う)。
export const baseVertexShader = /* glsl */ `
  precision highp float;
  attribute vec2 aPosition;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;

  void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2( texelSize.x, 0.0 );
    vR = vUv + vec2( texelSize.x, 0.0 );
    vT = vUv + vec2( 0.0, texelSize.y );
    vB = vUv - vec2( 0.0, texelSize.y );
    gl_Position = vec4( aPosition, 0.0, 1.0 );
  }
`;

// uTextureをそのままコピーするだけのパス。resize時にresizeFBO/resizeDoubleFBOが
// 旧テクスチャを新解像度へblitして引き継ぐためのコピー先としても使う。
export const copyShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;

  void main () {
    gl_FragColor = texture2D( uTexture, vUv );
  }
`;

// pressure jacobi反復の前段で、前フレームのpressureを倍率valueで減衰させてから
// 次フレームの反復の初期値(warm start)として使う。0にハードクリアしないことで
// Jacobi反復の収束を速める(前例と同じ考え方)。
export const clearShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;

  void main () {
    gl_FragColor = value * texture2D( uTexture, vUv );
  }
`;

// 指由来のforceをvelocityのRGだけへガウシアン形状で加算する。
// dye/tracerへの注入は無い(このshaderはvelocity専用、呼び出し側もvelocity
// 以外には使わない)。
export const splatShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec2 point;
  uniform vec2 force;
  uniform float radius;

  void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec2 splat = exp( -dot( p, p ) / radius ) * force;
    vec2 base = texture2D( uTarget, vUv ).xy;
    gl_FragColor = vec4( base + splat, 0.0, 1.0 );
  }
`;

// divergence(速度場の発散)。境界はclamp相当の反射条件(画面外を仮想的に
// 反対方向の速度として扱い、境界を「壁」として扱う)。
export const divergenceShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D( uVelocity, vL ).x;
    float R = texture2D( uVelocity, vR ).x;
    float T = texture2D( uVelocity, vT ).y;
    float B = texture2D( uVelocity, vB ).y;

    vec2 C = texture2D( uVelocity, vUv ).xy;
    if ( vL.x < 0.0 ) { L = -C.x; }
    if ( vR.x > 1.0 ) { R = -C.x; }
    if ( vT.y > 1.0 ) { T = -C.y; }
    if ( vB.y < 0.0 ) { B = -C.y; }

    float div = 0.5 * ( R - L + T - B );
    gl_FragColor = vec4( div, 0.0, 0.0, 1.0 );
  }
`;

// pressure Jacobi反復の1ステップ。
export const pressureShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;

  void main () {
    float L = texture2D( uPressure, vL ).x;
    float R = texture2D( uPressure, vR ).x;
    float T = texture2D( uPressure, vT ).x;
    float B = texture2D( uPressure, vB ).x;
    float C = texture2D( uPressure, vUv ).x;
    float divergence = texture2D( uDivergence, vUv ).x;
    float pressure = ( L + R + B + T - divergence ) * 0.25;
    gl_FragColor = vec4( pressure, 0.0, 0.0, 1.0 );
  }
`;

// gradient subtract(pressure projection)。velocityから圧力勾配を引き、
// 発散をほぼ0へ近づける。
export const gradientSubtractShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying highp vec2 vUv;
  varying highp vec2 vL;
  varying highp vec2 vR;
  varying highp vec2 vT;
  varying highp vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;

  void main () {
    float L = texture2D( uPressure, vL ).x;
    float R = texture2D( uPressure, vR ).x;
    float T = texture2D( uPressure, vT ).x;
    float B = texture2D( uPressure, vB ).x;
    vec2 velocity = texture2D( uVelocity, vUv ).xy;
    velocity.xy -= vec2( R - L, T - B );
    gl_FragColor = vec4( velocity, 0.0, 1.0 );
  }
`;

// semi-Lagrangian advection。velocityの自己移流とtracerの移流の両方に
// 同じshaderを使う(uVelocity=移流させる速度場, uSource=運ばれる対象)。
// uManualFilteringが1.0のときだけ手動bilinear補間を使う
// (half float texture linear filteringが使えないWebGL環境向けのfallback。
// 前例のMANUAL_FILTERING defineと同じ目的をuniform分岐で実現している)。
export const advectionShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform vec2 dyeTexelSize;
  uniform float dt;
  uniform float dissipation;
  uniform float uManualFiltering;

  vec4 bilerp ( sampler2D sam, vec2 uv, vec2 tsize ) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor( st );
    vec2 fuv = fract( st );

    vec4 a = texture2D( sam, ( iuv + vec2( 0.5, 0.5 ) ) * tsize );
    vec4 b = texture2D( sam, ( iuv + vec2( 1.5, 0.5 ) ) * tsize );
    vec4 c = texture2D( sam, ( iuv + vec2( 0.5, 1.5 ) ) * tsize );
    vec4 d = texture2D( sam, ( iuv + vec2( 1.5, 1.5 ) ) * tsize );

    return mix( mix( a, b, fuv.x ), mix( c, d, fuv.x ), fuv.y );
  }

  vec4 sampleSource ( sampler2D sam, vec2 uv, vec2 tsize ) {
    if ( uManualFiltering > 0.5 ) {
      return bilerp( sam, uv, tsize );
    }
    return texture2D( sam, uv );
  }

  void main () {
    vec2 coord = vUv - dt * sampleSource( uVelocity, vUv, texelSize ).xy * texelSize;
    vec4 result = sampleSource( uSource, coord, dyeTexelSize );
    gl_FragColor = dissipation * result;
  }
`;

// 起動時とResetの瞬間だけ呼ぶ、tracerの初期分布生成パス。
// 固定seedのhashベースvalue noise(smoothstep補間で格子線なし)を低い基本周波数
// で2層だけ合成し、baseline(中立的な中間値)を中心に低振幅で揺らす。
// Rだけに書き込み、G/B/Aは常に0。pointer入力からは一切呼ばれない。
export const initTracerShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uSeed;
  uniform float uFrequency;
  uniform float uAmplitude;
  uniform float uBaseline;

  float hash ( vec2 p ) {
    p = fract( p * vec2( 123.45, 678.91 ) + uSeed );
    p += dot( p, p + 34.345 );
    return fract( p.x * p.y );
  }

  float valueNoise ( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    float a = hash( i );
    float b = hash( i + vec2( 1.0, 0.0 ) );
    float c = hash( i + vec2( 0.0, 1.0 ) );
    float d = hash( i + vec2( 1.0, 1.0 ) );
    vec2 u = f * f * ( 3.0 - 2.0 * f ); // smoothstep補間。格子線状の不連続を作らない
    return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
  }

  void main () {
    float n1 = valueNoise( vUv * uFrequency );
    float n2 = valueNoise( vUv * uFrequency * 1.9 + 11.0 );
    float n = n1 * 0.7 + n2 * 0.3; // 低周波2層だけの合成。直線的な勾配は作らない
    float r = clamp( uBaseline + ( n - 0.5 ) * uAmplitude, 0.0, 1.0 );
    gl_FragColor = vec4( r, 0.0, 0.0, 1.0 );
  }
`;

// tracerのRチャンネルをそのまま中立グレースケールで表示するだけの診断表示。
// 渦・発光・色変化等の演出は無い。uContrastGainはbaseline(0.5)からの偏差を
// 見やすくするためだけのコントラスト増幅で、tracerが非ゼロな空間的範囲や
// 値そのものを変えるものではない。
export const displayShader = /* glsl */ `
  precision mediump float;
  precision mediump sampler2D;
  varying vec2 vUv;
  uniform sampler2D uTracer;
  uniform float uContrastGain;
  uniform vec3 uBgColor;
  uniform vec3 uFgColor;

  void main () {
    float r = texture2D( uTracer, vUv ).x;
    float v = clamp( 0.5 + ( r - 0.5 ) * uContrastGain, 0.0, 1.0 );
    vec3 color = mix( uBgColor, uFgColor, v );
    gl_FragColor = vec4( color, 1.0 );
  }
`;
