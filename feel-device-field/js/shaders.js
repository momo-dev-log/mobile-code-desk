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
export const dyeComputeShader = /* glsl */ `
  uniform sampler2D textureDye;
  uniform vec2 uPointer;
  uniform float uPointerActive;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uDissipation;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float dye = texture2D( textureDye, uv ).r;

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
  uniform sampler2D uDye;
  uniform vec3 uBgColor;
  uniform vec3 uInkColor;

  void main() {
    float dye = texture2D( uDye, vUv ).r;
    vec3 color = mix( uBgColor, uInkColor, clamp( dye, 0.0, 1.0 ) );
    gl_FragColor = vec4( color, 1.0 );
  }
`;
