/* =========================================================================
 * 感触装置 v0.1.2 PR-A (field検証) — シェーダー定義
 *
 * dye field（濃さの場）だけを持つ最小構成。
 * velocity / advection / pressure / curl はまだ扱わない。
 * ========================================================================= */

export const DYE_RESOLUTION = 128;

// dye fieldの1ステップ分の更新。
// 1) 前フレームのdye(textureDye)を読む
// 2) dissipationで毎フレーム少し薄める
// 3) 指が触れていれば、現在のpointer位置にガウス状のsplatを加える
//    （前回位置との補間は行わない。線ではなくsplatとして入れる）
//
// 注意: "uniform sampler2D textureDye;" はここで宣言してはいけない。
// GPUComputationRendererがdependency名(="textureDye")から自動で
// 同名のuniformを注入するため、手動宣言すると redefinition エラーになる。
export const dyeComputeShader = /* glsl */ `
  uniform vec2 uPointer;
  uniform float uPointerActive;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uDissipation;
  uniform float uTime;
  uniform float uDt;
  uniform float uDriftStrength;

  // PR-C.1: 乱数を使わない決定的な2D流れ。x/yで周波数・位相をずらし、
  // 中心からの距離(atan2等)に依存させないことで、単一の渦や中心への
  // 吸い込みに見えないようにする。空間的に粗く、時間変化も遅い。
  vec2 driftField( vec2 uv, float t ) {
    float dx = sin( uv.y * 6.283185 * 1.3 + t * 0.07 )
             + 0.5 * sin( uv.x * 6.283185 * 0.8 - t * 0.05 );
    float dy = cos( uv.x * 6.283185 * 1.1 - t * 0.06 )
             + 0.5 * cos( uv.y * 6.283185 * 1.6 + t * 0.04 );
    return vec2( dx, dy );
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;

    // PR-C.1: 前フレームdyeを読むサンプリング位置だけを、上記の流れでbacktrace
    // する（dissipation/splatより前。dissipation→splatという既存の順序は変えない）。
    vec2 driftOffset = driftField( uv, uTime ) * uDriftStrength * uDt;
    float dye = texture2D( textureDye, uv - driftOffset ).r;

    dye *= uDissipation;

    if ( uPointerActive > 0.5 ) {
      float d = distance( uv, uPointer );
      float falloff = exp( -( d * d ) / ( uRadius * uRadius ) );
      dye += uStrength * falloff;
    }

    dye = clamp( dye, 0.0, 1.0 );
    gl_FragColor = vec4( dye, 0.0, 0.0, 1.0 );
  }
`;

// dye fieldをそのまま画面全体に映すだけの最小表示シェーダー。
// 背景色とインク色を、dyeの濃度で線形補間するだけ（美しさはまだ調整しない）。
export const displayVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position, 1.0 );
  }
`;

export const displayFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uDyeTexture;
  uniform vec3 uBgColor;
  uniform vec3 uInkColor;

  void main() {
    float dye = texture2D( uDyeTexture, vUv ).r;
    vec3 color = mix( uBgColor, uInkColor, clamp( dye, 0.0, 1.0 ) );
    gl_FragColor = vec4( color, 1.0 );
  }
`;
