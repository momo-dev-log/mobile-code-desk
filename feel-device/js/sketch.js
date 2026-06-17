/* =========================================================================
 * 感触装置（仮称）v0.1 検証版
 *
 * 目的（作品完成ではなく、作風校正のための検証）:
 *   - persistence の消え方を見る
 *   - drift の揺らぎを見る
 *   - スマホで重くないか見る
 *
 * 段階1: p5を起動し、スマホ縦持ちで表示、指でなぞると点が出る
 * 段階2: persistenceで墨の消え方を見る
 * 段階3: diffusion（半透明の同心円の重ね）で滲み、driftでnoiseベースの揺らぎ
 *
 * 校正メモ（2回目のスマホ確認後の調整）:
 *   - 「背景を半透明で重ねて薄める」方式は、画面に薄い灰色が
 *     消えない残骸として居座る問題があったため、persistenceの仕組み自体を
 *     寿命ベースの粒子描画に変更した（詳細は inkPoints 関連の処理を参照）。
 *
 * 校正メモ（3回目のスマホ確認後の調整）:
 *   - なぞった線が「粒の連なり」に見え、孤立した点も残っていたため、
 *     (1) 点の間隔を詰めて補間を密にし、
 *     (2) 指がほぼ止まっている間は新しい点を増やさず、
 *     (3) 動きが遅い区間の点は最初からインクを薄くし（孤立した濃い点を防ぐ）、
 *     (4) 見えなくなる手前の点は早めに配列から外し、
 *     (5) 点は年齢とともに半径も縮む、ようにした。
 *     「線が薄くほどける」見え方を狙った調整（詳細は addStrokeSegment / strength / radiusScale）。
 *
 * 方針メモ:
 *   - p5 は instance mode
 *   - v0.1 は 1本指のみ（マルチタッチの下準備はしない）
 *   - 将来のデッドゾーン実装を見据え、入力は Pointer Events で扱う
 *     （p5 の touches 配列で複数指を処理する方向には進めない）
 *   - diffusion は canvas filter を使わず、半透明の同心円を重ねる（スマホ負荷対策）
 *
 * 校正は下の PARAMS をコード上で書き換えて行う（UIはまだ作らない）。
 * ========================================================================= */

const PARAMS = {
  // ── 色味（検証用）──
  bgColor:  '#f7f7f5',   // 背景
  inkColor: '#1a1a1a',   // 墨

  // ── persistence（寿命ベース）──
  // 「跡を背景で薄めて重ねる」方式はやめ、墨の点ごとに寿命(lifetime)を持たせる。
  // 毎フレーム背景は通常クリアし、生きている点だけを age に応じた alpha で
  // 描き直す。寿命を過ぎた点は配列から削除するので、最後は必ず背景に戻る。
  lifetimeMs: 4000,        // 1点が生きている時間(ms)。3000〜5000で調整
  fadeCurveExponent: 1.6,  // alphaScale = (1 - age/lifetime)^exponent
                           // 1なら線形。大きいほど序盤は濃く残り、終盤に急に消える
  minVisibleAlpha: 2,      // 実効alpha（0〜255）がこれを下回ったら、寿命前でも
                           // 見えなくなったとみなして配列から外す
  endRadiusScale: 0.4,     // 寿命を迎える頃の半径は元の何倍まで縮むか（0〜1）
                           // ageに応じてalphaだけでなくradiusも縮め、丸い点が
                           // そのまま残るのではなく小さくほどけるようにする

  // ── diffusion（滲み）──
  // 半透明の同心円を内側から外側へ重ねて、輪郭をぼかす。
  diffusionLayers:     4,   // 重ねる円の枚数（多いほど重い）
  diffusionMaxRadius:  11,  // 一番外側の円の半径(px)
  diffusionCoreRadius: 3,   // 中心の最も濃い円の半径(px)
  inkLayerAlpha:       28,  // 生まれた直後（age=0）の1枚あたりの不透明度（0〜255）

  // ── drift（揺らぎ）──
  // 完全ランダムではなく noise() の滑らかな揺らぎで描画位置をずらす。
  // 寿命の間も毎フレーム現在の driftT で計算するので、生きている間ずっと揺れ続ける。
  driftAmount: 6,      // 揺らぎの最大ずれ幅(px)
  driftScale:  0.012,  // 空間方向のnoiseスケール（小さいほど大きくうねる）
  driftSpeed:  0.01,   // 時間方向のnoise進行（大きいほど速く揺れる）

  // ── 描画の連続性 ──
  // 指を速く動かしても点が途切れないよう、前回位置との間を補間する。
  stepSpacing: 3,        // 補間する点の間隔(px)。小さいほど線が密になり滑らかに見える
  minMoveDist: 1.2,      // この距離未満しか動いていない時は新しい点を増やさない
                         // （ほぼ止まっている間に同じ場所へ点を量産し、孤立した
                         //   濃い点が残ることを防ぐ）

  // ── 速度に応じたインクの濃さ ──
  // 動きが速いほど点を濃く、遅い/止まりかけ（ストロークの終端など）ほど薄くする。
  // 終端付近に濃い点が居座って「孤立した粒」に見える問題を抑える。
  fullStrengthSpeed: 5,  // この速さ(px/フレーム)以上でインクが最大濃度になる
  minStrength: 0.35,     // 動きが遅くてもこれより下げない最小濃度（0〜1）

  // ── 追従ラグ（墨は指にぴったり付かず、少し遅れて追いかける）──
  // 墨の描画位置は指の現在位置（target）ではなく、それを追いかける
  // follow位置を使う。followLerpが小さいほど遅れが大きい。
  followLerp:     0.16, // 1フレームで詰める残り距離の割合（0〜1）
  followMaxSpeed: 16,   // followが1フレームで進める最大距離(px)。
                        // 指を速く振っても墨はこれより速く動かない。

  // ── 負荷対策 ──
  // 生存中の点の数に上限を設け、速い連続入力でも描画コストが
  // 無制限に増えないようにする（上限を超えたら古い点から捨てる）。
  maxInkPoints: 400,
};

const sketch = (p) => {

  // 1本指のみ追跡する。Pointer Events で現在アクティブな pointerId を保持。
  let activePointerId = null;
  let isDown = false;
  let targetX = 0, targetY = 0; // 指の現在位置（入力そのもの）
  let followX = 0, followY = 0; // 墨が実際に描かれる位置（targetを遅れて追う）

  // drift 用の noise 時間軸（フレームごとに進める）
  let driftT = 0;

  // 寿命ベースの墨の点。各要素は { x, y, bornAt }
  let inkPoints = [];

  p.setup = () => {
    const c = p.createCanvas(p.windowWidth, p.windowHeight);
    c.parent('canvas-holder');
    p.pixelDensity(1);        // 高DPIで描き過ぎないようにして負荷を抑える
    p.noStroke();
    p.background(PARAMS.bgColor);

    bindPointerEvents(c.elt);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    // 毎フレーム背景は通常クリア。残像は「重ねて薄める」のではなく、
    // 生きている点だけを描き直すことで表現する（後述 renderAliveInkPoints）。
    p.background(PARAMS.bgColor);

    // 指が触れている間だけ墨を置く
    if (isDown) {
      const prevFollowX = followX;
      const prevFollowY = followY;

      // followを指の位置(target)へ少しだけ近づける＝遅れて追いかける
      followX += (targetX - followX) * PARAMS.followLerp;
      followY += (targetY - followY) * PARAMS.followLerp;

      // 1フレームで進む距離に上限を設け、速い指の動きにも墨が
      // 同じ速さでは追従しない（置いていかれる）ようにする
      let moveDist = p.dist(prevFollowX, prevFollowY, followX, followY);
      if (moveDist > PARAMS.followMaxSpeed) {
        const scale = PARAMS.followMaxSpeed / moveDist;
        followX = prevFollowX + (followX - prevFollowX) * scale;
        followY = prevFollowY + (followY - prevFollowY) * scale;
        moveDist = PARAMS.followMaxSpeed;
      }

      // ほぼ動いていない時は新しい点を増やさない（同じ場所への量産を防ぐ）
      if (moveDist >= PARAMS.minMoveDist) {
        addStrokeSegment(prevFollowX, prevFollowY, followX, followY, moveDist);
      }
    }

    renderAliveInkPoints();

    driftT += PARAMS.driftSpeed;
  };

  // 前回位置→現在位置を一定間隔で補間しながら、墨の点を連ねて追加する。
  // 動きが速いほど濃く(strength→1)、遅いほど薄く(strength→minStrength)。
  function addStrokeSegment(x0, y0, x1, y1, moveDist) {
    const strength = p.constrain(
      moveDist / PARAMS.fullStrengthSpeed, PARAMS.minStrength, 1);
    const steps = Math.max(1, Math.floor(moveDist / PARAMS.stepSpacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      addInkPoint(p.lerp(x0, x1, t), p.lerp(y0, y1, t), strength);
    }
  }

  function addInkPoint(x, y, strength) {
    inkPoints.push({ x, y, bornAt: p.millis(), strength });
    // 上限を超えたら古い点から間引く（負荷対策。どうせ寿命も近い）
    if (inkPoints.length > PARAMS.maxInkPoints) {
      inkPoints.splice(0, inkPoints.length - PARAMS.maxInkPoints);
    }
  }

  // ── persistence（寿命） + 段階3: diffusion + drift ──
  // 生きている点だけ age に応じた alpha で再描画し、寿命切れの点は配列から外す。
  // これにより、跡は必ずいつか完全に背景へ戻る。
  function renderAliveInkPoints() {
    const now = p.millis();
    const alive = [];
    for (const pt of inkPoints) {
      const age = now - pt.bornAt;
      if (age >= PARAMS.lifetimeMs) continue; // 寿命切れは描かずに捨てる

      const ageRatio = age / PARAMS.lifetimeMs; // 0(生まれた直後)〜1(寿命)
      const fadeScale = Math.pow(1 - ageRatio, PARAMS.fadeCurveExponent);
      const effectiveAlpha = PARAMS.inkLayerAlpha * pt.strength * fadeScale;
      // 見た目上ほぼ消えている点は、寿命前でも配列から外す
      // （孤立した薄い点がだらだら残り続けるのを防ぐ）
      if (effectiveAlpha < PARAMS.minVisibleAlpha) continue;

      alive.push(pt);
      const radiusScale = p.lerp(1, PARAMS.endRadiusScale, ageRatio);
      renderInkPoint(pt, effectiveAlpha, radiusScale);
    }
    inkPoints = alive;
  }

  function renderInkPoint(pt, alpha, radiusScale) {
    // drift: 元のx/yから、現在のdriftTで滑らかにずらした位置に描く
    // （寿命の間、毎フレーム計算し直すので生きている間ずっと揺れ続ける）
    const ox = p.map(p.noise(pt.x * PARAMS.driftScale, driftT), 0, 1,
                     -PARAMS.driftAmount, PARAMS.driftAmount);
    const oy = p.map(p.noise(pt.y * PARAMS.driftScale, driftT + 100), 0, 1,
                     -PARAMS.driftAmount, PARAMS.driftAmount);
    const dx = pt.x + ox;
    const dy = pt.y + oy;

    const ink = p.color(PARAMS.inkColor);
    ink.setAlpha(alpha);
    p.fill(ink);
    p.noStroke();

    // 外側の薄い円 → 内側の濃い芯、の順で重ねる
    // age が進むほど radiusScale が縮み、点が小さくほどけていく
    for (let i = PARAMS.diffusionLayers; i >= 1; i--) {
      const tt = i / PARAMS.diffusionLayers; // 1(外)→ ~0(内)
      const r = p.lerp(PARAMS.diffusionCoreRadius,
                       PARAMS.diffusionMaxRadius, tt) * radiusScale;
      p.circle(dx, dy, r * 2);
    }
  }

  /* ---------------------------------------------------------------------
   * 入力: Pointer Events（1本指のみ）
   * 最初に触れた指の pointerId だけを追跡し、他の指は無視する。
   * 将来のデッドゾーン判定はこの層に足していく想定。
   * ------------------------------------------------------------------- */
  function bindPointerEvents(el) {
    el.addEventListener('pointerdown', (e) => {
      if (activePointerId !== null) return; // すでに1本追跡中なら無視
      activePointerId = e.pointerId;
      isDown = true;
      // 触れた瞬間はラグなしで指の位置に一致させる（ラグはなぞっている間だけ効く）
      targetX = followX = e.offsetX;
      targetY = followY = e.offsetY;
      // 指が画面端に動いても move を取り続けられるよう capture
      if (el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      }
      // 最初の接地点にも一点置く（タップそのものなので濃さは最大）
      addInkPoint(followX, followY, 1);
      e.preventDefault();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      // ここでは目標位置だけ更新する。実際の描画位置(follow)は
      // draw() 側で毎フレーム遅れて追いつかせる。
      targetX = e.offsetX;
      targetY = e.offsetY;
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      if (e.pointerId !== activePointerId) return;
      isDown = false;
      activePointerId = null;
      e.preventDefault();
    };
    el.addEventListener('pointerup', release, { passive: false });
    el.addEventListener('pointercancel', release, { passive: false });
  }
};

// p5 instance mode で起動
new p5(sketch);
