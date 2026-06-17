/* =========================================================================
 * 感触装置（仮称）v0.1 検証版
 *
 * 目的（作品完成ではなく、作風校正のための検証）:
 *   - persistence の消え方を見る
 *   - drift の揺らぎを見る
 *   - スマホで重くないか見る
 *
 * 段階1: p5を起動し、スマホ縦持ちで表示、指でなぞると点が出る
 * 段階2: persistenceで前フレームを薄く残し、墨の消え方を見る
 * 段階3: diffusion（半透明の同心円の重ね）で滲み、driftでnoiseベースの揺らぎ
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

  // ── persistence（残像の消え方）──
  // 毎フレーム、背景色を薄く重ねて前フレームを少しずつ消す。
  // 値が大きいほど速く消える / 小さいほど長く残る（0〜255）。
  fadeAlpha: 6,

  // ── diffusion（滲み）──
  // 半透明の同心円を内側から外側へ重ねて、輪郭をぼかす。
  diffusionLayers:     5,   // 重ねる円の枚数（多いほど重い）
  diffusionMaxRadius:  14,  // 一番外側の円の半径(px)
  diffusionCoreRadius: 3,   // 中心の最も濃い円の半径(px)
  inkLayerAlpha:       40,  // 1枚あたりの墨の不透明度（0〜255）

  // ── drift（揺らぎ）──
  // 完全ランダムではなく noise() の滑らかな揺らぎで描画位置をずらす。
  driftAmount: 6,      // 揺らぎの最大ずれ幅(px)
  driftScale:  0.012,  // 空間方向のnoiseスケール（小さいほど大きくうねる）
  driftSpeed:  0.01,   // 時間方向のnoise進行（大きいほど速く揺れる）

  // ── 描画の連続性 ──
  // 指を速く動かしても点が途切れないよう、前回位置との間を補間する。
  stepSpacing: 4,      // 補間する点の間隔(px)
};

const sketch = (p) => {

  // 1本指のみ追跡する。Pointer Events で現在アクティブな pointerId を保持。
  let activePointerId = null;
  let isDown = false;
  let curX = 0, curY = 0;     // 現在のポインタ位置
  let prevX = 0, prevY = 0;   // 直前に描画した位置

  // drift 用の noise 時間軸（フレームごとに進める）
  let driftT = 0;

  p.setup = () => {
    const c = p.createCanvas(p.windowWidth, p.windowHeight);
    c.parent('canvas-holder');
    p.pixelDensity(1);        // 高DPIで描き過ぎないようにして負荷を抑える
    p.noStroke();
    p.background(PARAMS.bgColor);

    bindPointerEvents(c.elt);
  };

  p.windowResized = () => {
    // リサイズ時はキャンバスを作り直す（残像は消えるが検証では許容）
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    p.background(PARAMS.bgColor);
  };

  p.draw = () => {
    // ── 段階2: persistence ──
    // 背景色を薄く重ねて、前フレームの墨を少しずつ消していく。
    p.noStroke();
    const bg = p.color(PARAMS.bgColor);
    bg.setAlpha(PARAMS.fadeAlpha);
    p.fill(bg);
    p.rect(0, 0, p.width, p.height);

    // 指が触れている間だけ墨を置く
    if (isDown) {
      drawStrokeSegment(prevX, prevY, curX, curY);
      prevX = curX;
      prevY = curY;
    }

    driftT += PARAMS.driftSpeed;
  };

  // 前回位置→現在位置を一定間隔で補間しながら、滲んだ点を連ねる
  function drawStrokeSegment(x0, y0, x1, y1) {
    const dist = p.dist(x0, y0, x1, y1);
    const steps = Math.max(1, Math.floor(dist / PARAMS.stepSpacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = p.lerp(x0, x1, t);
      const y = p.lerp(y0, y1, t);
      drawInkBlob(x, y);
    }
  }

  // ── 段階3: diffusion + drift ──
  // 同心円を内→外でalphaを保ちつつ重ねて滲みを作り、
  // 描画位置は noise() による滑らかなdriftでずらす。
  function drawInkBlob(x, y) {
    // drift: x/y で別々の noise を引いて、滑らかな揺らぎオフセットを得る
    const ox = p.map(p.noise(x * PARAMS.driftScale, driftT), 0, 1,
                     -PARAMS.driftAmount, PARAMS.driftAmount);
    const oy = p.map(p.noise(y * PARAMS.driftScale, driftT + 100), 0, 1,
                     -PARAMS.driftAmount, PARAMS.driftAmount);
    const dx = x + ox;
    const dy = y + oy;

    const ink = p.color(PARAMS.inkColor);
    ink.setAlpha(PARAMS.inkLayerAlpha);
    p.fill(ink);
    p.noStroke();

    // 外側の薄い円 → 内側の濃い芯、の順で重ねる
    for (let i = PARAMS.diffusionLayers; i >= 1; i--) {
      const tt = i / PARAMS.diffusionLayers; // 1(外)→ ~0(内)
      const r = p.lerp(PARAMS.diffusionCoreRadius,
                       PARAMS.diffusionMaxRadius, tt);
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
      curX = prevX = e.offsetX;
      curY = prevY = e.offsetY;
      // 指が画面端に動いても move を取り続けられるよう capture
      if (el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      }
      // 最初の接地点にも一点置く
      drawInkBlob(curX, curY);
      e.preventDefault();
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      curX = e.offsetX;
      curY = e.offsetY;
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
