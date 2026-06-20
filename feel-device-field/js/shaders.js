/* =========================================================================
 * 感触装置 — scalar core gate test v1
 *
 * 検証する一点だけ: 「入力が去った後も、既存の場だけが自律的に伝播して
 * 収まる」こと。媒質の見た目(墨/水/煙等)は今回の検証対象ではない。
 *
 * fieldはRチャンネルのscalar disturbanceだけを持つ。G/B/Aは常に0。
 * 入力はpointerdownの1回だけのcompact tapで、pointermove/pointerup後の
 * 追加入力は一切ない。毎フレーム、既存のRに対してdiffusion→dissipationだけを
 * 適用する。
 * ========================================================================= */

export const FIELD_RESOLUTION = 128;

// fieldの1ステップ分の更新。
// 1) 前フレームのR(textureField)を読む
// 2) diffusion: 中心と上下左右4近傍の平均へ、dt補正した係数でだけ寄せる
// 3) dissipation: 全体をdt補正した倍率で減衰する
// 4) pointerdown直後の1フレームだけ、uPointerActive=1でtapを加える
//
// 注意: "uniform sampler2D textureField;" はここで宣言してはいけない。
// GPUComputationRendererがdependency名(="textureField")から自動で
// 同名のuniformを注入するため、手動宣言すると redefinition エラーになる。
export const fieldComputeShader = /* glsl */ `
  uniform vec2 uPointer;
  uniform float uPointerActive; // pointerdown直後の1フレームだけ1。それ以外は常に0
  uniform float uTapRadius;
  uniform float uTapStrength;
  uniform float uDiffusionStrength;
  uniform float uDecay;
  uniform float uDt;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec2 texel = 1.0 / resolution.xy;

    float center = texture2D( textureField, uv ).r;
    float left   = texture2D( textureField, uv - vec2( texel.x, 0.0 ) ).r;
    float right  = texture2D( textureField, uv + vec2( texel.x, 0.0 ) ).r;
    float up     = texture2D( textureField, uv + vec2( 0.0, texel.y ) ).r;
    float down   = texture2D( textureField, uv - vec2( 0.0, texel.y ) ).r;
    float neighborAvg = ( left + right + up + down ) * 0.25;

    // diffusion: uDiffusionStrengthは60fps基準の混合係数(0〜1)。
    // dtベースの係数へ変換することで、120Hz等でも実時間あたりの伝播量が
    // ほぼ変わらないようにする。center/neighborAvgの凸結合なので、
    // dtがどれだけ大きくても発散しない。
    float diffusionFactor = 1.0 - pow( 1.0 - uDiffusionStrength, uDt * 60.0 );
    float r = mix( center, neighborAvg, diffusionFactor );

    // dissipation: uDecayは60fps基準の1フレームあたりの倍率。
    // dt*60乗にスケールすることで、120Hz等でも実時間あたりの減衰率が
    // ほぼ変わらないようにする(soften/dissipationと同じdt補正の考え方)。
    float dissipationFactor = pow( uDecay, uDt * 60.0 );
    r *= dissipationFactor;

    // pointerdown直後の1フレームだけ、コンパクトなscalar disturbanceを加える。
    // pointermove/pointerup後はuPointerActiveが常に0になるため、ここを通らない。
    if ( uPointerActive > 0.5 ) {
      float d = distance( uv, uPointer );
      float falloff = exp( -( d * d ) / ( uTapRadius * uTapRadius ) );
      r += uTapStrength * falloff;
    }

    r = clamp( r, 0.0, 1.0 );
    gl_FragColor = vec4( r, 0.0, 0.0, 0.0 );
  }
`;

// fieldをそのまま画面全体に映すだけの中立な診断表示。
// 墨/紙/水/煙を想起させない配色(無彩色)にし、低い値も視認できるよう
// sqrt(平方根)のトーンカーブだけを掛ける。これは値の大小を見やすくする
// 表示上のガンマ補正であり、fieldが非ゼロな空間的範囲そのものは変えない
// (広がっているように錯覚させるための閾値・演出ではない)。
export const displayVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position, 1.0 );
  }
`;

export const displayFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uFieldTexture;
  uniform vec3 uBgColor;
  uniform vec3 uFgColor;

  void main() {
    float r = clamp( texture2D( uFieldTexture, vUv ).r, 0.0, 1.0 );
    float visible = sqrt( r );
    vec3 color = mix( uBgColor, uFgColor, visible );
    gl_FragColor = vec4( color, 1.0 );
  }
`;
