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
  uniform float uSoftenStrength;

  // PR-seq: 速いstrokeだけ、pointerup後に始点→終点の順で少し遅れて解放する補助。
  // uReleaseEpoch=0は「解放中のstrokeなし」を意味する（B channelは1始まりのため衝突しない）。
  uniform float uReleaseEpoch;
  uniform float uReleaseFront;
  uniform float uReleaseAssist;
  uniform float uHoldDissipationStrong;
  uniform float uStrokeEpoch;
  uniform float uStrokeDistance;

  // PR-C.1: 乱数を使わない決定的な2D流れ。x/yで周波数・位相をずらし、
  // 中心からの距離(atan2等)に依存させないことで、単一の渦や中心への
  // 吸い込みに見えないようにする。空間的に粗く、時間変化も遅い。
  // PR-D.1ではuDriftStrength=0で無効化するが、形自体は削除しない。
  vec2 driftField( vec2 uv, float t ) {
    float dx = sin( uv.y * 6.283185 * 1.3 + t * 0.07 )
             + 0.5 * sin( uv.x * 6.283185 * 0.8 - t * 0.05 );
    float dy = cos( uv.x * 6.283185 * 1.1 - t * 0.06 )
             + 0.5 * cos( uv.y * 6.283185 * 1.6 + t * 0.04 );
    return vec2( dx, dy );
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec2 texel = 1.0 / resolution.xy;

    // PR-C.1: 前フレームdyeを読むサンプリング位置だけを、上記の流れでbacktrace
    // する（dissipation/splatより前。dissipation→splatという既存の順序は変えない）。
    // uDriftStrength=0のときはdriftOffsetが常にゼロになり、実質無効化される。
    vec2 driftOffset = driftField( uv, uTime ) * uDriftStrength * uDt;
    vec2 sampleUv = uv - driftOffset;

    // PR-D.1: 位置はほぼ変えず、輪郭だけを静かにほどく。中心と上下左右4近傍を
    // 読み、その平均へごく少量だけ寄せる（diffusion / edge relaxation）。
    // テクスチャはClampToEdgeWrapping前提のため、境界では折り返しが起きず、
    // 方向性のある流れも生まれない。
    // PR-seq: G/Bはstrokeのorder/epoch記録用のため、ここでは近傍mixの対象にしない
    // （Rだけsoftenする）。
    vec4 centerColor = texture2D( textureDye, sampleUv );
    float left   = texture2D( textureDye, sampleUv - vec2( texel.x, 0.0 ) ).r;
    float right  = texture2D( textureDye, sampleUv + vec2( texel.x, 0.0 ) ).r;
    float up     = texture2D( textureDye, sampleUv + vec2( 0.0, texel.y ) ).r;
    float down   = texture2D( textureDye, sampleUv - vec2( 0.0, texel.y ) ).r;
    float neighborAvg = ( left + right + up + down ) * 0.25;

    // uSoftenStrengthは60fps基準の係数。dtベースの係数に変換し、
    // 120Hz等でも実時間あたりの混ざり量がほぼ変わらないようにする
    // （PR-B.1のlag追従と同じdt補正の考え方）。
    float softenFactor = 1.0 - pow( 1.0 - uSoftenStrength, uDt * 60.0 );
    float dye = mix( centerColor.r, neighborAvg, softenFactor );

    // PR-seq: 直近1本のstrokeだけ、pointerup後にrelease front(uReleaseFront)が
    // 始点(distance=0)→終点へ進む間、front未到達部分(strokeDistance > uReleaseFront)
    // だけ強めに保持する。uReleaseAssist=0のときはuDissipationと完全に同じ値になり、
    // 遅いstrokeの挙動は今までどおりになる。
    float strokeEpochAtTexel = centerColor.b;
    float strokeDistanceAtTexel = centerColor.g;
    bool isReleaseTarget = ( uReleaseEpoch > 0.5 ) && ( abs( strokeEpochAtTexel - uReleaseEpoch ) < 0.5 );
    bool notYetReleased = strokeDistanceAtTexel > uReleaseFront;
    float dissipationFactor = ( isReleaseTarget && notYetReleased )
      ? mix( uDissipation, uHoldDissipationStrong, uReleaseAssist )
      : uDissipation;

    dye *= dissipationFactor;

    // G/Bはdissipation/softenの影響を受けず、splat範囲外では前フレームの値をそのまま保持する。
    float outG = centerColor.g;
    float outB = centerColor.b;

    if ( uPointerActive > 0.5 ) {
      float d = distance( uv, uPointer );
      float falloff = exp( -( d * d ) / ( uRadius * uRadius ) );
      dye += uStrength * falloff;

      // splat範囲内(falloffが十分大きいtexel)だけ、現在のstrokeのepoch/距離を記録する。
      if ( falloff > 0.5 ) {
        outG = uStrokeDistance;
        outB = uStrokeEpoch;
      }
    }

    dye = clamp( dye, 0.0, 1.0 );
    gl_FragColor = vec4( dye, outG, outB, 1.0 );
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
