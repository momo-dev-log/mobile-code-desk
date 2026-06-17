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
 *     「線が薄くほどける」見え方を狙った調整（詳細は strength / radiusScale 関連の処理）。
 *     （この時点での点の発生処理 addStrokeSegment は、後の4回目の調整で
 *       distance-baseな emitInkAlongPath に置き換えられた）
 *
 * 校正メモ（4回目のスマホ確認後の調整）:
 *   - ゆっくりなぞると同じ場所付近に粒が重なって濃くなる問題があった。
 *     原因は、粒の発生が「フレームごと」になっていたこと
 *     （1フレームの移動距離が小さくても、最低1粒は置いていた）。
 *     そのため低速時は粒の密度が上がり、結果的に黒い塊に見えていた。
 *   - 粒の発生を「フレーム」ではなく「直前に粒を置いた位置からの移動距離」
 *     基準に変更した（emitInkAlongPath）。stepSpacing分進むごとに1粒、
 *     という発生になり、速度に関わらず単位距離あたりの粒の数が一定になる。
 *     指が止まっていれば距離が貯まらないので、何フレーム経っても粒は増えない
 *     （minMoveDistによるフレーム単位のゲートは不要になったため削除した）。
 *
 * 校正メモ（5回目の追加フィードバック後の調整）:
 *   - 押し続けるとその場が濃くなっていく挙動自体は残しつつ、長押しで
 *     真っ黒な塊になりすぎないよう、押し始めからの経過時間でstrengthに
 *     掛ける倍率を徐々に下げるようにした（pressStrengthDecayMs/
 *     pressStrengthMinScale。詳細はemitInkAlongPath）。
 *   - 指を離した瞬間にピタッと止めず、少し余韻を残してから消えるようにする
 *     ため、離す直前の方向へ線がまっすぐ伸びる「release tail」を追加した。
 *     （後の6回目の調整で、この直線的なtailはafter-bloomに置き換えられた）
 *
 * 校正メモ（6回目の調整: release tail → after-bloom）:
 *   - 実機で確認した結果、release tailは「線が指から離れた方向へ
 *     ピューッと伸びる」ように見え、狙っていた「ふわっと膨らんでほどける」
 *     印象とは違っていた。そのため直線的に移動するtailの仕組みを廃止し、
 *     離した位置の付近で柔らかく膨らんで溶ける「after-bloom」に置き換えた
 *     （詳細はupdateAfterBloom/spawnBloomParticle）。
 *   - after-bloomは中心位置をほとんど動かさず（離す直前の方向へ
 *     bloomForwardOffsetMaxまでだけ少し進めた位置を中心にする）、その周りに
 *     bloomParticleCount個の粒を放射状に置く。各粒の角度は直前の移動方向を
 *     基準にbloomAngleSpreadDegの範囲でランダムに広げるため、一直線ではなく
 *     扇状〜放射状に広がる。
 *   - 粒はbloomBurstMsの間に少しずつ（段階的に）発生させ、後から生まれる粒
 *     ほど中心からの距離が大きくなりやすいようにして「徐々に膨らんでいく」
 *     見え方にした。外側の粒ほどstrengthを下げ（bloomOuterStrengthScale）、
 *     輪郭が硬くならないようにしている。
 *   - bloomの粒は通常のストロークより短い専用の寿命(bloomLifetimeMs)を持つ
 *     ようにaddInkPointへlifetimeMsを渡せるようにした。これにより、bloomは
 *     通常の線が消えるより先にほどけて消え、残骸として居座らない。
 *   - tail専用の距離ベース発生処理だったemitAlongDistanceは呼び出し元が
 *     emitInkAlongPathだけになったため、emitInkAlongPathに戻した
 *     （bloomは経路に沿った発生ではなく、放射状に直接addInkPointする）。
 *
 * 校正メモ（7回目の調整: after-bloomをデフォルトオフに）:
 *   - after-bloom実装後の実機確認で、「柔らかくほどける」ではなく
 *     「点や短い線が増えた」ように見えるという判断になった。線本体には
 *     persistence（寿命ベースのfade）による余韻がもともと出ており、問題は
 *     余韻が足りないことではなく、after-bloomが粒を追加したこと自体だった。
 *   - そのため、余韻は「足す」のではなく既存の墨が薄まる・広がる・遅れる
 *     方向（persistence/diffusion/followラグ）で作る方針に戻すことにした。
 *   - after-bloomのコード（PARAMS・状態変数・updateAfterBloom/
 *     spawnBloomParticle）は比較用に残しつつ、bloomEnabled: false により
 *     リリース時にbloomが一切起動しないようにした。bloomEnabledがfalseの間は
 *     PR #77以前と同じ、線本体（persistence + diffusion + drift +
 *     followラグ）だけの挙動になる。
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

  // ── 描画の連続性（距離ベースの粒の発生）──
  // 墨は「時間（フレーム）」ではなく「移動距離」を基準に置く。直前に粒を
  // 置いた位置から stepSpacing 分だけ進むごとに、新しい粒を1つ置く
  // （emitInkAlongPath参照）。ゆっくりなぞって何フレームかけて進んでも、
  // 速くなぞって1フレームで進んでも、同じ距離なら同じ数の粒になる。
  // 指が止まっていれば距離が貯まらないので、その場に粒が量産されることもない。
  stepSpacing: 3,  // 何px進むごとに1粒置くか。小さいほど線が密になり滑らかに見える

  // ── 速度に応じたインクの濃さ ──
  // 粒の「数」は移動距離だけで決まるが、粒1つあたりの濃さ(strength)は
  // 指の速さでも変える。速いほど濃く、遅い/止まりかけほど薄くする。
  fullStrengthSpeed: 5,  // この速さ(60fps相当のpx/フレーム)以上で最大濃度になる
  minStrength: 0.22,     // 動きが遅くてもこれより下げない最小濃度（0〜1）
                         // 低速時に粒が濃く見える問題を抑えるため0.35から下げた

  // ── 長押し時の濃さの上限（pressStrength）──
  // 「押している時間が長いほど少し濃くなる」感触自体は残しつつ、同じ場所に
  // 粒が無限に積み重なって真っ黒な塊になることを防ぐため、押し始めからの
  // 経過時間でstrengthに掛ける倍率を徐々に下げる（emitInkAlongPathで使用）。
  pressStrengthDecayMs: 500,  // この時間で倍率がpressStrengthMinScaleまで下がる
  pressStrengthMinScale: 0.35, // 長押しを続けた時の最小倍率（0〜1）

  // ── リリース後の余韻（after-bloom）──
  // 指を離した瞬間にピタッと止めず、離した位置の付近で柔らかく膨らんで
  // ほどける「滲み」を出す（updateAfterBloom/spawnBloomParticleで使用）。
  // 直線的に伸びるtailとは違い、中心位置はほとんど動かさず、周囲へ放射状に
  // 粒を広げるだけにする。
  // 7回目の調整で「点や短い線が増えて見える」と判断し、デフォルトでは
  // 起動しないようにした（bloomEnabled: false）。コードは比較用に残している。
  bloomEnabled: false,         // falseの間はリリース時にbloomが一切起動しない
  bloomBurstMs: 220,           // 粒が段階的に発生し終わるまでの時間(ms)
  bloomLifetimeMs: 900,        // bloomの粒だけに使う専用の寿命(ms)。通常のlifetimeMsより短め
  bloomMaxRadius: 32,          // 中心からの最大距離(px)。粒はこの範囲内にランダムに置かれる
  bloomForwardOffsetMax: 9,    // 中心位置を離す直前の方向へ進める距離の上限(px)
  bloomAngleSpreadDeg: 85,     // 直前の移動方向を基準に、左右何度まで粒の角度を散らすか
  bloomParticleCount: 14,      // 1回のbloomで発生させる粒の総数
  bloomStrength: 0.4,          // bloomの粒の濃さの基準値（通常ストロークより薄め）
  bloomOuterStrengthScale: 0.4, // 中心から最も遠い粒のstrengthが基準値の何倍まで下がるか

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
  let lastEmitX = 0, lastEmitY = 0; // 直前に粒を置いた位置（距離ベースの発生に使う）
  let pressStartTime = 0; // 押し始めの時刻（長押しのstrength上限の計算に使う）
  let lastFollowVelX = 0, lastFollowVelY = 0; // 直前フレームのfollow移動量（離した瞬間の余韻の初速に使う）

  // リリース後の余韻（after-bloom）の状態
  let bloomActive = false;
  let bloomCenterX = 0, bloomCenterY = 0; // 粒を散らす中心位置（ほとんど動かさない）
  let bloomBaseAngle = 0;                 // 離す直前の移動方向（粒の角度のばらつきの基準）
  let bloomStartTime = 0;
  let bloomSpawned = 0;                   // すでに発生させた粒の数

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

      // 指の速さ（フレームレートに依存しないよう60fps相当のpx/フレームへ
      // 正規化）。粒を置くかどうかの判断には使わない。strength（濃さ）だけに使う。
      const frameScale = Math.max(p.deltaTime, 1) / (1000 / 60);
      const speed = moveDist / frameScale;

      // 離した瞬間のafter-bloomの向き・中心位置の計算に使うため、直前フレームの移動量を覚えておく
      lastFollowVelX = followX - prevFollowX;
      lastFollowVelY = followY - prevFollowY;

      emitInkAlongPath(speed);
    }

    updateAfterBloom();

    renderAliveInkPoints();

    driftT += PARAMS.driftSpeed;
  };

  // 直前に粒を置いた位置(lastEmitX/Y)から現在のfollow位置までの距離が
  // stepSpacing分進むごとに、新しい粒を1つ置く。フレーム数や経過時間とは
  // 無関係に、移動距離だけで粒の数が決まる。
  function emitInkAlongPath(speed) {
    // 押し続けている時間が長いほどstrengthを下げ、同じ場所に粒が
    // 無限に積み重なって真っ黒な塊になることを防ぐ
    const holdMs = p.millis() - pressStartTime;
    const holdScale = p.lerp(1, PARAMS.pressStrengthMinScale,
      p.constrain(holdMs / PARAMS.pressStrengthDecayMs, 0, 1));

    const strength = p.constrain(
      speed / PARAMS.fullStrengthSpeed, PARAMS.minStrength, 1) * holdScale;

    const segLen = p.dist(lastEmitX, lastEmitY, followX, followY);
    if (segLen < PARAMS.stepSpacing) return;

    const steps = Math.floor(segLen / PARAMS.stepSpacing);
    let lastX = lastEmitX;
    let lastY = lastEmitY;
    for (let i = 1; i <= steps; i++) {
      const t = (i * PARAMS.stepSpacing) / segLen;
      lastX = p.lerp(lastEmitX, followX, t);
      lastY = p.lerp(lastEmitY, followY, t);
      addInkPoint(lastX, lastY, strength);
    }
    // 最後に置いた粒の位置を起点に更新する。stepSpacing未満の余りの距離は
    // そのまま次フレーム以降の距離計算に持ち越される。
    lastEmitX = lastX;
    lastEmitY = lastY;
  }

  // 指を離した後、離した位置の付近で柔らかく膨らんでほどける「after-bloom」。
  // 直線的に移動するのではなく、ほぼ固定した中心(bloomCenterX/Y)の周りへ
  // 放射状に粒を散らす。粒はbloomBurstMsの間に段階的に発生させ、後から
  // 生まれる粒ほど中心からの距離が広がりやすくして「徐々に膨らむ」見せ方にする。
  function updateAfterBloom() {
    if (!bloomActive) return;

    const t = p.millis() - bloomStartTime;
    if (t >= PARAMS.bloomBurstMs) {
      for (let i = bloomSpawned; i < PARAMS.bloomParticleCount; i++) spawnBloomParticle(i);
      bloomActive = false;
      return;
    }

    const targetSpawned = Math.floor((t / PARAMS.bloomBurstMs) * PARAMS.bloomParticleCount);
    while (bloomSpawned < targetSpawned) {
      spawnBloomParticle(bloomSpawned);
      bloomSpawned++;
    }
  }

  // index番目の粒を1つ発生させる。indexが大きいほど（後から生まれるほど）
  // 中心からの距離が広がりやすく、外側の粒ほどstrengthを下げる。
  function spawnBloomParticle(index) {
    const progress = index / Math.max(PARAMS.bloomParticleCount - 1, 1); // 0(最初)→1(最後)
    const radius = p.random(
      PARAMS.bloomMaxRadius * 0.15,
      PARAMS.bloomMaxRadius * (0.4 + 0.6 * progress));

    const angleOffsetDeg = p.random(-PARAMS.bloomAngleSpreadDeg, PARAMS.bloomAngleSpreadDeg);
    const angle = bloomBaseAngle + p.radians(angleOffsetDeg);

    const x = bloomCenterX + Math.cos(angle) * radius;
    const y = bloomCenterY + Math.sin(angle) * radius;

    const radiusRatio = radius / PARAMS.bloomMaxRadius;
    const strength = PARAMS.bloomStrength * p.lerp(1, PARAMS.bloomOuterStrengthScale, radiusRatio);

    addInkPoint(x, y, strength, PARAMS.bloomLifetimeMs);
  }

  function addInkPoint(x, y, strength, lifetimeMs = PARAMS.lifetimeMs) {
    inkPoints.push({ x, y, bornAt: p.millis(), strength, lifetimeMs });
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
      if (age >= pt.lifetimeMs) continue; // 寿命切れは描かずに捨てる

      const ageRatio = age / pt.lifetimeMs; // 0(生まれた直後)〜1(寿命)
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
      bloomActive = false; // 新しいタッチが始まったら前の余韻は打ち切る
      pressStartTime = p.millis();
      // 触れた瞬間はラグなしで指の位置に一致させる（ラグはなぞっている間だけ効く）
      targetX = followX = e.offsetX;
      targetY = followY = e.offsetY;
      lastEmitX = followX; // 距離ベースの粒発生の起点もここにリセット
      lastEmitY = followY;
      lastFollowVelX = 0;
      lastFollowVelY = 0;
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

      // bloomEnabledがfalseの間は何もしない（線本体だけの挙動になる）。
      // trueの場合のみ、離す直前に動いていたときだけその場で柔らかく膨らむ
      // after-bloomを始める。中心は離した位置から、直前の方向へ
      // bloomForwardOffsetMaxまでだけ少し進めた位置にする。
      const speedAtRelease = Math.hypot(lastFollowVelX, lastFollowVelY);
      if (PARAMS.bloomEnabled && speedAtRelease > 0.0001) {
        const dirAngle = Math.atan2(lastFollowVelY, lastFollowVelX);
        const forwardOffset = Math.min(speedAtRelease, PARAMS.bloomForwardOffsetMax);
        bloomCenterX = followX + Math.cos(dirAngle) * forwardOffset;
        bloomCenterY = followY + Math.sin(dirAngle) * forwardOffset;
        bloomBaseAngle = dirAngle;
        bloomActive = true;
        bloomStartTime = p.millis();
        bloomSpawned = 0;
      }
      e.preventDefault();
    };
    el.addEventListener('pointerup', release, { passive: false });
    el.addEventListener('pointercancel', release, { passive: false });
  }
};

// p5 instance mode で起動
new p5(sketch);
