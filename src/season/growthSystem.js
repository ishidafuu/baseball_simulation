// ============================================================
// シーズン成長システム - src/season/growthSystem.js
//
// yearProgressionSystem.js から成長・衰退の純粋計算関数群を抽出したもの。
// 選手能力の年齢カーブ成長/衰退・社会人/独立の実戦成長・自由契約の自主トレ成長・
// 成長率(growthModifier)の年度引き継ぎを担う。いずれも growthUtils / physics の
// ヘルパーのみに依存し、他の年間進行ロジックには依存しない（循環参照なし）。
// ============================================================

import { PHYSICAL_STATS, TECHNICAL_STATS, getAgeGrowthBase, getRecoveryAgeBase, getStatPath, getStatName, getNestedValue, setNestedValue, MUSCLE_STATS, DEXTERITY_STATS, physiqueMultFor, dexterityMult } from './growthUtils.js';
import { getVelocityCap, getVelocityCatchupMult } from '../utils/physics.js';
import { PITCHING_FORM_EFFECTS, FORM_PITCH_SYNERGY } from '../utils/constants.js';

// --- 成長率(growthModifier/growthPotential)の年度更新 ---
export function updateGrowthModifiers(allTeams, awards) {
  const championTeam = awards?.champion;

  Object.entries(allTeams).forEach(([teamName, team]) => {
    if (!team.players) return;
    const isChampion = teamName === championTeam;

    // ベテラン指導力: 30歳以上でdiscipline/mentalが高い選手が若手の成長を促進
    const veterans = team.players.filter(p => (p.age || 18) >= 30);
    let veteranBonus = 0;
    for (const vet of veterans) {
      // ⚠ プロ意識・精神力は `personality` の中にある。以前は `vet.discipline` を
      //    読んでいて常に既定の50になり、この加算は一度も働いていなかった
      const disc = vet.personality?.discipline ?? 50;
      const ment = vet.personality?.mental ?? 50;
      const leadership = (disc + ment) / 2;
      if (leadership >= 60) {
        veteranBonus += 0.01 + (leadership - 60) * 0.0005;
      }
    }
    veteranBonus = Math.min(0.06, Math.round(veteranBonus * 1000) / 1000);

    team.players.forEach(player => {
      const age = player.age || 18;
      // ⚠ **`growthPotential` を年齢で減衰させないこと**。
      //    旧実装は毎年 `-(age-23)*0.05` を積んでおり、30歳で累計 -1.40。
      //    つまり **30代の選手は全員 gp が 0 付近に潰れ**、個性が消えたうえ、
      //    年齢の効果が `basalGrowth` / `getAgeGrowthBase` と合わせて
      //    **3箇所**に重なっていた（衰退が三重に掛かる）。
      //    成長率は「その選手の素の伸びやすさ」という不変の個性として残し、
      //    年齢はカーブ側が単独で担う。

      // シーズン中に蓄積された変動を半減して次年度に引き継ぎ（徐々にゼロに戻る）
      let modifier = (player.growthModifier || 0) * 0.5;

      if (isChampion) {
        modifier += 0.05;
      }

      // ベテラン指導力: 25歳以下の若手にのみ適用
      if (age <= 25 && veteranBonus > 0) {
        modifier += veteranBonus;
      }

      player.growthModifier = Math.max(-0.3, Math.round(modifier * 100) / 100);
    });
  });
}

// 能力ごとの伸びやすさ（`grow()` の base）と、プロ級で減衰が始まる閾値。
// ⚠ **2つの成長関数で共有すること**。以前は `applyCorporatePlayerGrowth` と
//    `applyFreeAgentGrowth` に同じ数字が別々に書かれており、片方だけ直る事故が待っていた。
//
// ⚠ **base は `focus` / `strength` と掛け算で重なる**。社会人のミートは
//    base 3.0 × focus 1.9 × 長所 1.3 = 7.41、走力は 0.5 × 0.8 × 0.85 = 0.34 で
//    **22倍**の開きがあった。技術系だけが独走して、平均的な社会人が
//    ミート83（NPB主力級）まで伸びていた。順序（技術は伸びる・走力と肩は
//    才能で決まる）は正しいので、**上位の base だけを詰める**。
//      ミート 3.0→1.9 / 制球 3.0→1.9 / 守備 2.5→1.7 / 選球眼 2.0→1.5
// 成長率は **天井の高さ**でも効く。才能のある選手はプロ級(70)を超えてからも伸び、
// 才能のない選手は早く頭打ちになる。
// ⚠ **`decayMult` は正の delta にしか掛からない**ので、衰え始める年齢は動かない。
//    基礎成長のピークを上げる案（`BASAL_PEAK`）は総成長量そのものを増やして
//    しまい、衰え始めの散らばりも縮める。天井なら成長の「上限」だけを動かせる。
//    gp0.6 → 閾値64.4 / gp1.0 → 70 / gp1.4 → 75.6
// ⚠ **強くしすぎると社会人のトップがNPB超えになる**。
//    一度 40 / 1.35 にしたところ、成長率1.4の選手の実効天井が **125**（＝上限なし）
//    になり、社会人リーグに 守備99・制球97・ミート99 が現れた。
//    NPBレギュラー相当は ミート58 / 制球60 / 球速146 なので、
//    「努力で伸びる能力」だけがプロを追い越す形になっていた。
//    実効天井（減衰が1割まで落ちる位置）が gp0.6→80 / 1.0→88 / 1.4→94 に収まる値にする。
// ⚠ 成長率の説明力は**この天井ではなく `BASAL_GP_SHIFT` がほとんど稼いでいる**。
//    天井を 0 にしても 6.1%（12なら6.3%）で、強めても副作用しか増えない。
// 年次成長に掛ける体格補正の幅。毎年・全能力に掛かるので、キャンプ(1.0)より弱くする
const PHYSIQUE_W = 0.30;

// 【若いほど吸収が速い】練習成長の年齢係数。
// ⚠ 旧実装は **19歳と23歳の伸びがほぼ同じ**だった（19歳比 94%）。
//    実データの打者は 23-25歳で 20-22歳の約半分、26-27歳でほぼ0まで落ちる。
//    プロ1〜3年目に技術が一気に伸びる、という当たり前が出ていなかった。
// ⚠ **成長方向にだけ掛けること**（`physiqueMultFor` と同じ扱い）。練習項そのものに
//    掛けると `基礎 + 練習 = 0` の交点が動き、**衰え始める年齢が変わってしまう**。
//    正の delta にだけ掛ければ衰え始めは完全に不変（実測で 27/29/32/34/36/37 が一致）。
// ⚠ 到達点は**ほぼ変わらない。早く着くだけ**（平均ケースのミートのピーク 78→75）。
//    「22歳で成長が止まる」わけではない。
//    実測の19歳比: 21歳82% / 23歳60% / 25歳43% / 27歳31% / 29歳23%
const YOUTH_MULT = { 18: 1.95, 19: 1.85, 20: 1.68, 21: 1.50, 22: 1.32, 23: 1.16,
                     24: 1.07, 25: 1.00, 26: 0.95, 27: 0.90, 28: 0.87 };
const youthMult = (age) => YOUTH_MULT[age] ?? (age < 18 ? 1.95 : 0.85);

// 新球種の習得。⚠ **大学プールにしか無かった**。社会人・独立・クラブの投手は
// キャンプ以外に球種を増やす経路が無く、実測で12年進化させても球種数が
// **3.00 固定**のままだった。持ち球の「幅」は打者の読み合い
// （`arsenal.effectiveArsenalSize`）に直結するので、引き出しが増えないと
// 何年経っても同じ投手のままになる。
// 技術の場所である社会人が最も高く、指導者の居ないクラブは稀。
const NEW_PITCH_RATE = { corporate: 0.10, independent: 0.05, club: 0.02 };
const ALL_PITCH_TYPES = ['slider', 'curve', 'fork', 'changeup', 'sinker', 'shoot',
                         'cutter', 'splitter', 'twoSeam', 'palm', 'knuckle'];
function tryLearnNewPitch(player, categoryKey, discipline) {
  const arsenal = player.pitching?.arsenal;
  if (!arsenal) return;
  // プロ意識が高いほど新しい球に手を出す（意識50で基準）。
  // ⚠ **器用さも掛ける**（器用さ50で従来どおり）。キャンプ側だけに入れると
  //    「キャンプでだけ器用さが効く」ことになり、背景のCPUと食い違う。
  //    幅が控えめ(0.5)なのは**毎年掛かる**ため（`physiqueMultFor` の w と同じ理由）
  const rate = (NEW_PITCH_RATE[categoryKey] ?? 0.05) * (0.5 + discipline / 100)
    * dexterityMult(player, 0.5);
  if (Math.random() >= rate) return;
  const have = new Set(arsenal.map(a => a.type));
  const affinity = FORM_PITCH_SYNERGY[player.pitching?.form] || [];
  let pool = affinity.filter(t => !have.has(t));
  if (pool.length === 0) pool = ALL_PITCH_TYPES.filter(t => !have.has(t));
  if (pool.length === 0) return;
  const type = pool[Math.floor(Math.random() * pool.length)];
  const isAffinity = affinity.includes(type);
  const id = arsenal.length > 0 ? Math.max(...arsenal.map(a => a.id || 0)) + 1 : 1;
  // ⚠ 覚えたては Lv10〜25。CLAUDE.md の実測では **Lv10 は防御率がほぼ変わらず
  //    四球だけ +0.9 増える**＝覚えたてはむしろ損。磨いて初めて価値が出る。
  arsenal.push({ id, type, level: Math.floor(Math.random() * 16) + (isAffinity ? 12 : 6) });
}

const POTENTIAL_CEILING_W = 12;
const POTENTIAL_RATE_W = 0.20;
const gpClamp = (gp) => Math.max(0.3, Math.min(1.8, gp ?? 1.0));
/** プロ級(70)から減衰が始まる位置。才能があるほど遅い */
export const growthThreshold = (base, gp = 1.0) => base + (gpClamp(gp) - 1.0) * POTENTIAL_CEILING_W;
/** 減衰の速さ。才能があるほど緩やか＝天井が高い（実効の頭打ちは threshold + 0.9/rate） */
export const growthDecayRate = (base, gp = 1.0) =>
  Math.max(0.005, base * (1 - (gpClamp(gp) - 1.0) * POTENTIAL_RATE_W));

//
// ⚠ **`decline` は衰退方向だけに掛かる別プロファイル**。成長の速さと衰えの速さは
//    まったく別の話で、成長の `base` を流用すると実データと逆になる。
//    実測（ピーク→38歳）では パワー **-34%**（実 -10%）/ 選球眼 **-17%**（実 ほぼ0%）と
//    落ちすぎ、走力 -16%（実 -22%）と落ちなさすぎだった。
//    **「体力から落ち、技術は残る」**という基本が出ていなかった。
//    `npbCareer` は既に加齢プロファイルを別に持っている（肩0.5 / 走塁0.6 /
//    リードは落ちない）ので、こちらもそれに揃える。
// ⚠ **`peak` はピーク年齢のずらし（年）**。これが無いと
//    **ピーク年齢と成長速度が同じパラメーターで決まってしまう**。
//    成長量 = base × (基礎 + 練習 × 実効重み) で基礎は全能力共通なので、
//    **実効重みが小さい能力ほど早く交点に達する**。実測でピーク年齢が
//    実効重みときれいに並んでいた（ミート4.69→27歳 / 走力0.34→**19歳**）。
//    その結果 **走力と肩は高校を出た瞬間が最高**で、あとは落ちるだけだった。
//    「伸びにくい」ことと「ピークが早い」ことは別の話なので、軸を分ける。
//    実データのピーク: 走力22-24 / 肩24-26 / パワー27-29 / ミート26-27 /
//                     守備26-28 / 選球眼28-32（晩成）/ 球速24-26 / 制球28-32
// ⚠ **アマの打撃（ミート・パワー・選球眼）だけ天井を低く・急にしてある**（`ama`）。
//    守備・制球と同じ 52 / 0.05 だった頃は、大学S・社会人Sのスタメン野手の中央値が
//    ミート66/パワー66 と **NPBレギュラー基準（ミート58/パワー55）を上回り**、
//    大学Sのリーグで 打率.345 / 本塁打3.0本/チーム試合 という打ち合いになっていた。
//    アマチュアの平均はプロのレギュラーより下にあるべきなので、平均を下げる。
//    天井は gp で上へずれて緩む（`growthThreshold` / `growthDecayRate`）ので、
//    才能のある選手はここを越える＝「たまに凄い打者がいる」は残る。
// ⚠ **プロ（`CATEGORY_GROWTH.npb` の `pro: true`）は `ama` を使わない**。
//    共通の値を下げるとプロの打者まで伸びなくなる。
// ⚠ 天井を読むときは `ceilOf(g, isPro)` を通すこと（大学・自由契約・社会人の3経路）
export const ceilOf = (g, isPro = false) => (!isPro && g.ama) ? g.ama : g;
// floor … 天井を越えてからも残る伸びの割合（共通は 0.10）。アマの打撃は 0.02 にして
//         「天井の先は才能（gp）がある選手だけが進める」形にする。0.10 のままだと
//         社会人の厚い練習量（ミートの実効重み4.7）で毎年じりじり伸び、平均が下がらない
const AMA_BAT = { threshold: 42, rate: 0.09, floor: 0.02 };
// ⚠ **打撃だけ下げると投手が勝ちすぎる**。リーグの成績は能力の絶対値ではなく
//    打者と投手の「比」で決まるので、打撃の天井だけ下げたら社会人Sが 打率.210 /
//    2.8点/試合、自リーグ（独立）が 打率.168 まで落ちた。社会人Sの投手の制球は
//    中央値67〜69 と NPB基準（60）を超えていたので、制球にも同じアマの天井を掛ける。
//    球速は NPB基準（146）より既に低い（中央値136〜142）ので触らない
const AMA_CTL = { threshold: 46, rate: 0.08, floor: 0.03 };

export const STAT_GROWTH = {
  meet:     { peak: -1, ref: 50, base: 1.9, cap: 99,  threshold: 52, rate: 0.05, ama: AMA_BAT, decline: 0.66 },
  power:    { peak: 6, ref: 50, base: 1.5, cap: 99,  threshold: 52, rate: 0.05, ama: AMA_BAT, decline: 1.78 },
  eye:      { peak: 2, ref: 50, base: 1.5, cap: 99,  threshold: 52, rate: 0.05, ama: AMA_BAT, decline: 0.25 },
  defense:  { peak: -1, ref: 50, base: 1.7, cap: 99,  threshold: 52, rate: 0.05, decline: 0.80 },
  speed:    { peak: 4, ref: 50, base: 0.5, cap: 99,  threshold: 62, rate: 0.03, decline: 5.70 },
  arm:      { peak: 6, ref: 50, base: 0.5, cap: 99,  threshold: 62, rate: 0.03, decline: 6.20 },
  armP:     { peak: 6, ref: 50, base: 1.0, cap: 99,  threshold: 62, rate: 0.03, decline: 3.30 },  // 投手の肩
  control:  { peak: 1, ref: 50, base: 1.9, cap: 99,  threshold: 52, rate: 0.05, ama: AMA_CTL, decline: 0.44 },
  stamina:  { peak: 2, base: 2.0, cap: 200, threshold: 62, rate: 0.03, decline: 1.48 },
  velocity: { peak: 5, base: 0.5, cap: null, threshold: 142, rate: 0.20, decline: 6.00 },
  // 体力・体幹・器用さ。年次成長では直接伸ばさないが、**大学とキャンプが使うので
  // 物差しはここに置く**（進路で「体力60」の意味が変わらないようにするため）。
  bodyStamina: { peak: 2, ref: 50, base: 1.15, cap: 99, threshold: 62, rate: 0.03, decline: 1.00 },
  muscle:      { peak: 4, ref: 50, base: 0.77, cap: 99, threshold: 62, rate: 0.03, decline: 0.60 },
  dexterity:   { peak: 4, ref: 50, base: 0.77, cap: 99, threshold: 62, rate: 0.03, decline: 0.40 },
  // 回復力は加齢で落ちる一方（`getRecoveryAgeBase` が別に担当）。ここは成長側だけ
  recovery:    { peak: 2, ref: 50, base: 0.77, cap: 99, threshold: 62, rate: 0.03, decline: 1.20 },
  // ⚠ **変化球とリードは長らく年次成長の対象外だった**。社会人・独立・クラブの
  //    投手は7年経ってもスライダーLv30のまま、捕手はリード40のままだった
  //    （大学プールだけが `applyUniversityGrowth` で伸ばしていた）。
  //    どちらも「実戦で最も磨かれる」ものなので、実戦成長の対象に入れる。
  breaking: { peak: 4, ref: 50, base: 1.3, cap: 100, threshold: 52, rate: 0.04, decline: 0.20 },
  // リードは経験の積み上げ。**加齢で落ちない**（`npbCareer` の加齢処理と同じ扱い）
  lead:     { peak: 6, ref: 50, base: 1.1, cap: 95,  threshold: 52, rate: 0.05, decline: 0 },
};

// --- 自由契約選手の自主トレ成長 ---
// ⚠ **成長の式を二重に持たないこと**。以前はここだけ旧式（`zeroAge` の分岐＋
//    discipline の3乗の崖）が残っており、他が変わっても取り残されていた。
//    「チームが無い」ことは **練習量(`FA_VOLUME`)と環境(`FA_GAIN`)が低い**
//    という形で表す。プロ意識の効き方（`disciplineTrainMult`）は共通。
const FA_VOLUME = 0.55;   // 自主トレのみ。実戦も指導者も無い
const FA_GAIN = 0.80;     // 環境も無い（チーム所属のランクD 0.80 相当）
export function applyFreeAgentGrowth(pool) {
  const decayMult = (current, threshold, rate, floor = 0.10) => {
    if (current < threshold) return 1.0;
    return Math.max(floor, 1.0 - (current - threshold) * rate);
  };

  for (const player of pool) {
    const age = player.age || 25;
    const gp = player.growthPotential || 1.0;
    const discipline = player.personality?.discipline ?? 50;

    // ⚠ growthPotential は年齢で減衰させない（`updateGrowthModifiers` の注記を参照）
    player.growthModifier = Math.max(-0.3, Math.round((player.growthModifier || 0) * 0.5 * 100) / 100);

    const basal = basalGrowth(age, gp);
    const practice = FA_VOLUME * disciplineTrainMult(discipline) * youthMult(age);

    const grow = (current, key, baseMult = 1, capOverride = null) => {
      const g = STAT_GROWTH[key];
      const statBasal = g.peak ? basalGrowth(age, gp, g.peak) : basal;
      const delta = g.base * baseMult * (statBasal + practice) * FA_GAIN * (0.6 + Math.random() * 0.6);
      if (delta >= 0) {
        return Math.min(capOverride ?? g.cap, current + stochasticRound(delta * decayMult(current, growthThreshold(ceilOf(g).threshold, gp), growthDecayRate(ceilOf(g).rate, gp), ceilOf(g).floor)));
      }
      return Math.max(1, current + stochasticRound(dampDecline(current, delta * (g.decline ?? 1) * declineScale(current, g.ref))));
    };

    if (player.position === 'pitcher') {
      if (player.pitching) {
        player.pitching.control = grow(player.pitching.control, 'control');
        player.pitching.stamina = grow(player.pitching.stamina, 'stamina');
        const velCatchup = getVelocityCatchupMult(player.physical?.arm || 50, player.pitching.velocity);
        player.pitching.velocity = grow(player.pitching.velocity, 'velocity',
          velCatchup, getVelocityCap(player.physical?.arm || 50));
      }
      if (player.physical) {
        player.physical.arm = grow(player.physical.arm, 'armP');
      }
    } else {
      if (player.batting) {
        player.batting.meet  = grow(player.batting.meet,  'meet');
        player.batting.power = grow(player.batting.power, 'power');
        player.batting.eye   = grow(player.batting.eye,   'eye');
      }
      if (player.physical) {
        player.physical.speed = grow(player.physical.speed, 'speed');
        player.physical.arm   = grow(player.physical.arm,   'arm');
      }
      if (player.fielding) {
        player.fielding.defense = grow(player.fielding.defense, 'defense');
      }
    }

    // 知名度: 自主トレで結果を出しても無名のまま（知名度は試合出場で蓄積）
    // → 微増のみ（discipline 80+ で +1/年）
    if (discipline >= 80) {
      player.fame = Math.min(100, (player.fame || 0) + 1);
    }
  }
}

// ============================================================
// 実成長 = 基礎成長 + 練習成長
//
// 【住み分け】
//   成長率(growthPotential) … **基礎成長**。何もしなくても身体が育つ／衰える分。
//                              年齢の関数で、あるところからマイナスへ入る。
//   プロ意識(discipline)    … **練習成長に乗算**するもの。常に 0 以上。
//
// 基礎がマイナスへ入っても練習成長が上回れば伸び、釣り合えばステイ、
// 基礎の衰えが練習成長を超えたら**プロ意識が高くても衰える**。
// これで「20代中盤で衰える者」と「30代後半でも活躍する者」が同居する。
//
// ⚠ **旧実装は `effectiveFactor >= 0` で成長式と衰退式を切り替えていた**。
//    衰退式に `gp` が入っておらず、**プロ意識が低い選手は成長率がまったく
//    効かなかった**（意識0だと gp1.4 と gp0.6 が19歳から同じ -22.6/年）。
//    実測で母集団の3〜5割（19歳で30% / 28歳で55%）がその分岐に居た。
//    分岐を無くして和の符号だけで決めれば、両方が常に生きる。
// ============================================================

// 基礎成長のピークは **平坦**（18〜22歳）。身体的には18歳の方が伸びるので、
// 24歳に山を作らない。
//
// ⚠ **ピークの高さと衰え始めの散らばりはトレードオフ**。衰え始める年齢は
//    `基礎 = -練習` で決まるので、ピークが高いほどプロ意識の差が埋もれる。
//    実測: ピーク0.35 では 意識20/50/90 の衰え始めが 32/36/衰えず に潰れた
//    （練習量の差より基礎の下駄の方が大きいため）。0.14 まで下げて初めて
//    26/31/36 に開く。**基礎は「何もしなくても少しは伸びる」程度でよい**。
const BASAL_PEAK = 0.14;       // ピーク時の基礎成長（成長率1.0のとき）
const BASAL_PEAK_END = 22;
const BASAL_GP_SHIFT = 11;      // 成長率でピークの終わりが前後する（gp1.4→24.8歳 / gp0.6→19.2歳）
const BASAL_DECAY = 0.100;     // ピーク以降、1歳ごとの落ち幅
const BASAL_ACCEL = 0.015;     // 下り坂はわずかに加速する
const BASAL_FLOOR = -1.8;

/**
 * 基礎成長。練習と無関係に身体が育つ／衰える分。
 *
 * ⚠ **`growthPotential` は年齢を含まない素の個性として渡すこと**。
 *    年齢の効果はこの関数が単独で担う（`applyAgeCurveChanges` の
 *    `getAgeGrowthBase` と合わせて2箇所。それ以外に年齢の項を作らない）。
 */
export function basalGrowth(age, gp = 1.0, peakShift = 0) {
  const g = Math.max(0.3, Math.min(1.8, gp));
  const peak = g * BASAL_PEAK;
  const peakEnd = BASAL_PEAK_END + (g - 1) * BASAL_GP_SHIFT + peakShift;
  if (age <= peakEnd) return peak;
  const x = age - peakEnd;
  return Math.max(BASAL_FLOOR, peak - BASAL_DECAY * x * (1 + BASAL_ACCEL * x));
}

// 練習成長に掛かるプロ意識の倍率。**常に 0 以上**（練習は身体を削らない）。
// 意識10以下は「練習しない」＝基礎成長だけで生きる選手。
//   20→0.13 / 50→0.50 / 70→0.75 / 90→1.00 / 100→1.13
// ⚠ 幅を狭めると衰え始める年齢の散らばりが消える。この幅が
//   「20代中盤で終わる者」と「30代後半まで現役の者」を分けている。
const DISC_TRAIN_W = 1.45;
export function disciplineTrainMult(discipline = 50) {
  return Math.max(0, (discipline - 10) / 100) * DISC_TRAIN_W;
}

// 1年で失える割合の上限。**衰えても「小学生以下」までは落ちない**。
// ⚠ 下限でクランプしてはいけない（`corporateInit.taperLow` と同じ理由。
//    平均が押し上がってリーグの較正が動く）。**落ち幅を現在値に比例させる**と、
//    符号は変わらないので「衰え始める年齢」は完全に不変のまま、
//    崩壊だけが止まる。旧実装も新実装も、練習しない選手のミートが
//    最終的に **1** まで落ちていた（旧は27歳、新は40歳で到達）。
const DECLINE_MAX_RATE = 0.055;
const dampDecline = (current, delta) => Math.max(delta, -Math.max(1, current * DECLINE_MAX_RATE));

// ⚠ **衰えは能力値に比例させること**。`grow()` の delta は `base × 年齢係数` で
//    決まる**絶対量**なので、そのままだと「走力95でも走力40でも年 -1」になり、
//    **水準が高い選手ほど減衰率(%)が小さくなる**（実測 31→39歳で
//    走力30 -29.9% 対 走力90 -15.5%）。実際は一流のスプリンターも平凡な走者も
//    30代で同じ割合を失う。`ref` を基準に比例させると水準に依らず一定になる。
// ⚠ `ref` を持たない能力（スタミナ・球速）は**スケールが違う**ので絶対量のまま
//    （球速135を基準に比例させると120km投手と150km投手で失う km/h が倍違う）。
// ⚠ **確率的丸め**。`Math.round` は 0.5 未満の成長を毎年 0 に潰す。
//    実測で走力の年間成長は **0.364** しかなく、`Math.round` で
//    **一度も伸びないまま19歳がピーク**になっていた（肩・球速も同じ）。
//    base の小さい能力（走力0.5 / 肩0.5 / 球速0.5）は構造的にこれを踏む。
//    端数の確率で切り上げれば**期待値が正確に保たれる**（0.36 なら36%で+1）。
//    ⚠ 下限クランプや base の引き上げで代用しないこと——前者は平均を歪め、
//      後者は「走力は才能で決まる」という設計（実効重みの序列）を壊す。
export const stochasticRound = (v) => {
  const f = Math.floor(v);
  return f + (Math.random() < (v - f) ? 1 : 0);
};

// ============================================================
// 【プラトーとブレイクスルー】年ごとの伸びに**記憶**を持たせる
//
// ⚠ 旧実装の年次ノイズは `0.6 + random()*0.6` の**独立同分布**で、
//    隣接年の自己相関が実測 **0.026**（＝ほぼ無相関）だった。毎年ほぼ同じ幅で
//    単調に伸びるので、「2年伸び悩んで3年目に化ける」「フォームを崩して1年落ちる」
//    という育成で最も判断の難しい局面が存在しなかった。
//    実データの選手の年次成長は自己相関 0.2〜0.35（伸びる年は続く）。
//
// AR(1) の「充実度」を選手に持たせる。**平均1を保つ**ので、
// リーグの水準・指名の構成比は動かない（振れ方だけが変わる）。
// `_growthForm` は選手オブジェクトに載るのでセーブされる。
const FORM_RHO = 0.35;    // 前年をどれだけ引き継ぐか
const FORM_W = 0.38;      // 伸び幅への効き
// ⚠ **独立ノイズを絞って、そのぶんを記憶のあるノイズへ移すこと**。
//    `0.6 + random()*0.6`（σ/平均 0.19）を残したまま form を足しても、
//    独立成分が自己相関を薄めて 0.06 までしか上がらなかった。
//    平均0.9は保ったまま幅だけ狭める（`0.75 + random()*0.3`）。
const YEAR_NOISE_LO = 0.75, YEAR_NOISE_W = 0.30;
function advanceGrowthForm(player) {
  const u1 = Math.random() || 0.001, u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const prev = player._growthForm ?? 0;
  const next = FORM_RHO * prev + Math.sqrt(1 - FORM_RHO * FORM_RHO) * z;
  player._growthForm = Math.max(-2.5, Math.min(2.5, next));
  return Math.max(0.10, 1 + player._growthForm * FORM_W);
}

const DECLINE_SCALE_CLAMP = [0.55, 1.9];
const declineScale = (current, ref) => {
  if (!ref) return 1;
  return Math.max(DECLINE_SCALE_CLAMP[0], Math.min(DECLINE_SCALE_CLAMP[1], current / ref));
};

// --- 社会人/独立チーム選手の実戦経験による成長 ---
// ============================================================
// カテゴリごとの育成の性格（「弱者の兵法」）
//
// 進路によって鍛えられる場所が違う、というのがこのゲームの階層の意味。
//   大学   … 総合力（`applyUniversityGrowth` 側。specialties で7分野）
//   社会人 … **技術**。設備と指導者があるので制球・ミート・選球眼・守備が伸びる
//   独立   … **一芸**。試合に出て武器で勝負するしかない。長所が伸び短所は放置
//   クラブ … **基礎体力**。技術指導者が居ないので走・肩・スタミナしか伸びない
//
// ⚠ **これは「弱者の兵法」の実体**。総合力に優れた高校生は大学・社会人へ進んで
//   さらに万能になり、一芸型は独立・クラブへ進んでその一芸が磨かれる。
//   一芸型が数年後にドラフトの下位・育成で拾われる（`scoutTools` の一芸指名）
//   という経路は、ここで武器が磨かれて初めて成立する。
//
// ⚠ 従来は3カテゴリとも同じ傾斜（長所×1.4 / 短所×0.7）だった。
//   カテゴリを分けても選手の中身が同じになるので、進路に意味が無かった。
// ⚠ **`topN` を分けるのが要**。従来は全カテゴリ「上位2つが長所」だった。
//    独立の一芸は文字どおり **1つ**なので topN=1 にしないと尖らない
//    （実測: 上位2つのままだと 独立の尖り1.50 対 社会人1.46 とほぼ差が出なかった）。
// カテゴリの調整点は **2つあり、役割が違う**。混同しないこと。
//
//   `volume` … **練習量**。和の内側（`基礎 + 練習×volume`）に入るので、
//              動かすと **衰え始める年齢が動く**（練習が基礎の衰えを打ち消すため）。
//              「そのカテゴリの選手は何歳まで伸びるか」を決める。
//   `gain`   … **環境の質**。和の外側に掛かるので **符号を変えない**＝
//              衰え始める年齢は動かさず、成長・衰退の**振れ幅だけ**を変える。
//              「そのカテゴリの選手はどれだけ速く伸びるか」を決める。
//
// ⚠ 指名の構成比を合わせるときは `gain` を動かすこと。`volume` で合わせると
//    衰え始める年齢まで一緒に動き、30代の選手像が壊れる（独立を volume で
//    2倍にすると衰え始めが38歳になり、ベテランが誰も衰えなくなる）。
// ⚠ **基礎成長に `volume` は掛からない**。身体が勝手に育つ分は所属先で変わらない。
// draft-check は `growYears` を指定して `applyCorporatePlayerGrowth` を
// 実際に回してから指名する（0 だと成長を一度も通らず、ここを動かしても測定に映らない）。
// ⚠ **export してあるのは掃引して測るため**（`ind-share-probe.mjs` が `gain` を差し替える）。
//    関数の中で毎回 `CATEGORY_GROWTH[...]` を引くので、import 後に書き換えれば効く
export const CATEGORY_GROWTH = {
  // 独立: たった1つの武器に極端に寄せる。それ以外はほとんど伸びない
  independent: { volume: 1.34, gain: 0.88, topN: 1, strength: 2.6, weak: 0.20, focus: null },
  // 社会人: **技術で完成させる場所**。3カテゴリで技術系が最も伸びる。
  // ⚠ フィジカルを 0.7 まで下げたうえ技術も 1.5 止まりだったため、
  //    高卒→社会人ルート（19→22歳の3年）が**全進路で最弱**になっていた
  //    （実測 ドラフト到達 3〜6% 対 大学21〜24%）。実業団は設備も指導者も
  //    実戦もあるのだから、技術に関しては大学を上回って良い。
  corporate: {
    volume: 0.64, gain: 0.90, topN: 2, strength: 1.3, weak: 0.85,
    focus: { control: 1.9, meet: 1.9, eye: 1.8, defense: 1.8, breaking: 1.8, lead: 1.7,
             velocity: 0.8, speed: 0.8, arm: 0.9, stamina: 1.0, power: 1.0 },
  },
  // NPB: 練習量・環境ともに最高。**天井だけがアマより高い**（`ceilingShift`）。
  // ⚠ アマの天井（技術系52 → 実効70）はNPBレギュラー相当に置いてあるので、
  //    プロがそこで頭打ちになるとスター選手が生まれない。プロだけ +20 する。
  // ⚠ **練習量と環境を上げるだけにすること**。プロ意識・出場量（一軍/二軍）が
  //    そのまま効くので、「二軍暮らしが続くと伸びない」が自然に出る。
  npb: {
    volume: 1.00, gain: 0.80, ceilingShift: 14, topN: 2, strength: 1.25, weak: 0.85,
    pro: true,   // アマ専用の天井（`STAT_GROWTH[].ama`）を使わない
    // ⚠ focus は成長だけでなく**衰えの止まりにくさ**にも効く（練習項が基礎成長の
    //    マイナスを打ち消すため）。28→38歳の実測が 守備-15% 対 走力-16% と
    //    ほぼ並んでいた（実データは 守備-10 対 走力-22）。「体から落ち、技術は残る」を
    //    出すために、技術系を厚く・身体系を薄くしてある。
    focus: { control: 1.6, meet: 1.8, eye: 1.4, defense: 1.7, breaking: 1.4,
             velocity: 1.0, speed: 0.55, arm: 0.6, stamina: 1.1, power: 1.2, lead: 1.4 },
  },
  // オンラインの対人リーグ（12球団）の**年度替わりの自然成長**。
  // ⚠ 先方指摘（2026-11-16）: 「年度替わりの自然成長は成長係数を見て、フィジカルや精神が中心、
  //    若いほど伸びる。キャンプはプロ意識・体幹・器用さを見て、フィジカルと技術が中心」。
  //    それまでは独立リーグの一芸（topN=1）の式で、技術もフィジカルも同じくらい伸びていた。
  // ⚠ 能力の種類と若さの重み（`naturalPositive`）は**伸びる側だけ**に掛かる。focus は独立と同じ
  //    1.0（無し）のまま。
  // ⚠ ただし**衰えは前（独立の式）と同じではない**。`grow()` の伸びは `基礎 + 練習 × specMult` の和で、
  //    年を取って基礎が負になっても練習の項が打ち消すので、長所・短所の重み（topN・strength・weak）を
  //    独立（topN=1・2.6・0.20）からここ（topN=2・1.2・0.9）に変えたぶん、能力ごとの衰え始める年齢と
  //    落ち幅も動く（独立の一芸は衰えにくく、それ以外、とくに短所2つは早く大きく落ちていた。いまは均される）
  // ⚠ 一人用の世界の独立リーグ・社会人は触らない（`online` を渡したときだけ）
  online: {
    volume: 1.34, gain: 0.88, topN: 2, strength: 1.2, weak: 0.9, focus: null,
    natural: true,
  },
  // クラブ: 基礎体力だけ。技術は独学なのでほとんど伸びない
  club: {
    volume: 0.86, gain: 0.06, topN: 2, strength: 1.25, weak: 0.9,
    focus: { velocity: 1.7, speed: 1.9, arm: 1.9, stamina: 1.7, power: 1.5,
             control: 0.5, meet: 0.5, eye: 0.5, defense: 0.6, breaking: 0.5, lead: 0.5 },
  },
};

// ============================================================
// 成長の実行体。**カテゴリ（社会人/独立/クラブ/プロ）で共有する**。
//
// ⚠ ここを増やさないこと。以前は 大学・キャンプ・プロが別々の `grow()` を持ち、
//    同じ「ミート60」が場所によって別の意味になっていた。3作品で能力値を
//    共有する構想があるので、伸びやすさ・天井・ピーク年齢は `STAT_GROWTH`、
//    カテゴリの性格は `CATEGORY_GROWTH` の乗数だけで表す。
//
// @param opts.activity 出場量を外から与える（プロは一軍/二軍で決まる）
// ============================================================

/**
 * この1年の出場量（成長の練習量と知名度が見る）。投手は先発20・救援3、野手は打数。
 *
 * ⚠ 年度送りでは `resetSeasonStats` の**後**に呼ばれる。本物の試合をした球団
 *    （自チーム・同じリーグの球団）の `seasonStats` はもう0に戻っているので、
 *    **0なら直前に退避した `previousSeasonStats` を読む**。以前は自チームの
 *    レギュラーも控えも一律に最低の練習量（0.55）で、知名度は全員が下がっていた。
 *    作り物の成績を入れた並行世界の球団は `seasonStats` に入っているのでそちらを読む。
 * ⚠ 救援は「登板数−先発数」で数える。本物の試合は `gamesRelieved` を記録しない
 */
export function seasonActivity(player) {
  const of = (stats) => {
    if (player.position === 'pitcher') {
      const p = stats?.pitching;
      const started = p?.gamesStarted || 0;
      return started * 20 + Math.max(0, (p?.games || 0) - started) * 3;
    }
    return stats?.batting?.atBats || 0;
  };
  return of(player.seasonStats) || of(player.previousSeasonStats);
}

// ------------------------------------------------------------
// オンラインの自然成長（年度替わり）の伸び方
// ------------------------------------------------------------
// 能力の種類ごとの「伸びる側」の倍率。フィジカルを厚く、技術を薄く（技術はキャンプで伸ばす）。
// ⚠ 実測（`online-yearend-growth-probe.mjs`、初期セット12球団×6回、2026-11-16）:
//    21歳以下の野手 体力+2.1 精神+1.8 肩力+1.5 体幹+1.4 走力+0.9 パワー+0.8 守備+0.4（ミート・選球眼は+0.3未満）、
//    21歳以下の投手 体力+1.9 精神+1.7 体幹・肩力・走力+1.3 変化球+1.2 球速+1.0 スタミナ+1.0 制球+0.3。
//    22〜25歳はその半分ほど、26歳からは伸びより衰えが勝つ（衰えは前と同じ）。
//    前（独立リーグの式）は21歳以下の野手で 制球・肩力・守備+0.8 ミート+0.6 と技術もフィジカルも同じくらいだった
export const NATURAL_GROWTH_KIND = {
  speed: 2.2, arm: 2.2, armP: 1.8, velocity: 1.8, stamina: 1.6, bodyStamina: 1.8,
  power: 0.8,
  meet: 0.35, eye: 0.35, control: 0.35, defense: 0.35, breaking: 0.5, lead: 0.6,
  steal: 0.35, bunt: 0.35,
};
// 若いほど伸びる（伸びる側だけ）。成長係数は基礎成長（`basalGrowth`）と天井が見ている
const NATURAL_YOUTH = { 18: 1.6, 19: 1.5, 20: 1.4, 21: 1.3, 22: 1.15, 23: 1.05, 24: 0.95, 25: 0.85, 26: 0.75 };
export const naturalYouth = (age) => NATURAL_YOUTH[age] ?? (age < 18 ? 1.6 : 0.65);
/** 自然成長の伸びる側の倍率（能力の種類×若さ） */
export const naturalPositive = (key, age) => (NATURAL_GROWTH_KIND[key] ?? 1.0) * naturalYouth(age);

// 精神力・体幹の自然な伸び（1年あたりの期待値。成長係数1.0のとき）。
// ⚠ どちらも**年度更新では今まで一度も動かなかった**（精神力は初期値のまま、体幹はキャンプだけ）。
//    衰えは付けない（精神は経験で練れ、体幹はキャンプの体づくりで保つもの）
const MENTAL_BY_AGE = [[20, 2.0], [23, 1.5], [26, 1.0], [29, 0.6], [99, 0.3]];
const MUSCLE_BY_AGE = [[20, 1.6], [23, 1.1], [26, 0.6], [29, 0.2], [99, 0]];
const byAge = (table, age) => table.find(([upTo]) => age <= upTo)?.[1] ?? 0;
/**
 * 精神力・体幹を伸ばす（オンラインの年度替わりだけ）。成長係数（＋起用の補正）で 0.6〜1.3倍
 */
export function applyNaturalMindBody(player) {
  const age = player.age || 25;
  const gp = gpClamp((player.growthPotential ?? 1.0) + (player.growthModifier || 0));
  const scale = 0.6 + 0.4 * gp;
  if (player.personality && typeof player.personality.mental === 'number') {
    const gain = stochasticRound(byAge(MENTAL_BY_AGE, age) * scale);
    player.personality.mental = Math.min(99, player.personality.mental + Math.max(0, gain));
  }
  if (player.physical && typeof player.physical.muscle === 'number') {
    const gain = stochasticRound(byAge(MUSCLE_BY_AGE, age) * scale);
    player.physical.muscle = Math.min(99, player.physical.muscle + Math.max(0, gain));
  }
}

export function makeGrower(player, prof, rankMult = 1.0, opts = {}) {
  const decayMult = (current, threshold, rate, floor = 0.10) => {
    if (current < threshold) return 1.0;
    return Math.max(floor, 1.0 - (current - threshold) * rate);
  };
    const age = player.age || 25;
    const gp = player.growthPotential || 1.0;
    const discipline = player.personality?.discipline ?? 50;

    // 実成長 = 基礎成長 + 練習成長（**分岐なし。和の符号がすべて**）。
    // 設計は冒頭の「実成長 = 基礎成長 + 練習成長」の節を参照。
    const basal = basalGrowth(age, gp);
    // その年の充実度（前年を引き継ぐ）。⚠ 成長方向にだけ掛ける
    const formMult = advanceGrowthForm(player);
    // 実戦に出ているほど練習量が増える（出場も練習のうち）
    // ⚠ `opts.activity` を**読むこと**。プロ（`applyNpbGrowth`）は一軍300・二軍70を
    //    渡しているのに、以前は無視して空の成績を読み、一軍も二軍も同じ練習量だった
    const activity = opts.activity ?? seasonActivity(player);
    // ⚠ 旧式 `0.75 + min(0.5, activity/400)` は **200打席で上限に張り付いた**。
    //    レギュラーも準レギュラーも同じ 1.25 になり、出場量が結果を
    //    ほとんど説明しなかった（実測の説明力 0.8%）。
    //    レギュラー(240打席)の値は 1.25 のまま据え置き、**下を伸ばす**。
    //    控えは 0.45＝レギュラーの36%しか練習量を得られない。
    const activityMult = 0.55 + Math.min(0.95, activity / 300);   // 0.55〜1.50
    // ⚠ **若年前倒しは練習項にだけ掛けること**。「若いほど吸収が速い」は
    //    **練習の吸収**の話で、基礎成長は `basalGrowth` が自前の年齢カーブを
    //    持っている。実成長全体に掛けると**年齢の効果を二重に計上**する。
    //    練習項の中に入れると `基礎 + 練習 = 0` の交点が動くので、
    //    **衰え始める年齢の再較正とセット**になる（年配ほど練習で衰えを
    //    抑えられなくなる＝実際の関係と同じ向き）。
    const practice = (prof.volume ?? 1.0) * activityMult
      * disciplineTrainMult(discipline) * youthMult(age);

    // 長所特化倍率: 選手の能力値の相対的な高さで成長に傾斜をかける
    // 長所(上位)はより伸び、短所は伸びにくい → 分業制・専門化を再現
    let statEntries;
    if (player.position === 'pitcher') {
      statEntries = [
        { key: 'control', val: player.pitching?.control || 0 },
        { key: 'stamina', val: player.pitching?.stamina || 0 },
        { key: 'velocity', val: (player.pitching?.velocity || 130) - 100 },
        { key: 'arm', val: player.physical?.arm || 0 },
      ];
    } else {
      statEntries = [
        { key: 'meet', val: player.batting?.meet || 0 },
        { key: 'power', val: player.batting?.power || 0 },
        { key: 'eye', val: player.batting?.eye || 0 },
        { key: 'speed', val: player.physical?.speed || 0 },
        { key: 'arm', val: player.physical?.arm || 0 },
        { key: 'defense', val: player.fielding?.defense || 0 },
      ];
    }
    // ⚠ **傾斜は grow() の base（能力ごとの伸びやすさ）を覆せる強さが要る**。
    //    base はミート3.0 対 走力0.5 と6倍の開きがあるので、旧値（長所1.4 / 短所0.7）
    //    では「長所の走力 0.5×1.4=0.7」より「短所のミート 3.0×0.7=2.1」の方が
    //    3倍速く伸びていた。**長所を指定しているのに短所が伸びる**状態だった。
    // カテゴリの得意分野を掛けてから並べる（社会人は技術を、クラブは体力を長所と見る）
    statEntries.sort((a, b) =>
      (b.val * (prof.focus?.[b.key] ?? 1.0)) - (a.val * (prof.focus?.[a.key] ?? 1.0)));
    // ⚠ **一芸（topN=1）は毎年引き直してはいけない**。年ごとにその時点の1位が
    //    長所判定を受けるので、結果的に全能力が順番に伸びて**万能になる**
    //    （実測: 有望素材＋意識100 の独立選手が32歳で
    //     ミート88/パワー87/走力86/守備88）。一芸の設計と逆。
    //    最初に決めた1つを持ち続ける（`_sharpenedTool` は選手に載るのでセーブされる）。
    let strengthKeys;
    if (prof.topN === 1) {
      if (!player._sharpenedTool || !statEntries.some(e => e.key === player._sharpenedTool)) {
        player._sharpenedTool = statEntries[0].key;
      }
      strengthKeys = new Set([player._sharpenedTool]);
    } else {
      strengthKeys = new Set(statEntries.slice(0, prof.topN).map(e => e.key));
    }
    const weakKeys = new Set(statEntries.slice(-2).map(e => e.key));
    const specMult = (key) => {
      const shape = strengthKeys.has(key) ? prof.strength : weakKeys.has(key) ? prof.weak : 1.0;
      return shape * (prof.focus?.[key] ?? 1.0);
    };

    // key は STAT_GROWTH のキー。specKey は長所/短所・カテゴリ得意分野の判定に使う
    // 能力名（投手の肩 'armP' は 'arm' として見る）。
    const grow = (current, key, baseMult = 1, capOverride = null) => {
      const g = STAT_GROWTH[key];
      const specKey = key === 'armP' ? 'arm' : key;
      // 基礎は無方向（身体が勝手に育つ）。練習だけがカテゴリの性格を受ける
      // ⚠ 和の中なので、基礎が負になる年齢（衰え）でも練習×specMult が打ち消す。
      //    カテゴリの長所・短所の重みは、伸びだけでなく衰えの大きさにも効く
      const statBasal = g.peak ? basalGrowth(age, gp, g.peak) : basal;
      const delta = g.base * baseMult * (statBasal + practice * specMult(specKey))
        * rankMult * (prof.gain ?? 1.0) * (YEAR_NOISE_LO + Math.random() * YEAR_NOISE_W);
      if (delta >= 0) {
        // ⚠ 体格補正は**成長方向にだけ**掛ける（衰退には効かない）。
        //    この関数が担当する能力は `applyAgeCurveChanges` の対象外に
        //    してあるので、ここで掛けないと体幹・器用さが効かなくなる
        //    （実測: 体幹20と100の7年後の差が 3.3 → 0.1 に潰れていた）。
        const phys = physiqueMultFor(player, specKey, PHYSIQUE_W) * formMult
          // オンラインの自然成長: フィジカル厚め・技術薄め・若いほど（伸びる側だけ）
          * (prof.natural ? naturalPositive(key, age) : 1);
        return Math.min(capOverride ?? g.cap,
          current + stochasticRound(delta * phys * decayMult(current, growthThreshold(ceilOf(g, prof.pro).threshold + (prof.ceilingShift ?? 0), gp), growthDecayRate(ceilOf(g, prof.pro).rate, gp), ceilOf(g, prof.pro).floor)));
      }

      return Math.max(1, current + stochasticRound(dampDecline(current, delta * (g.decline ?? 1) * declineScale(current, g.ref))));
    };
  return { grow, age, gp, discipline };
}

/**
 * @param opts.online オンラインの対人リーグの球団名（Set）。渡した球団は自然成長の式
 *   （`CATEGORY_GROWTH.online`）で伸ばし、精神力・体幹も伸ばす（`applyNaturalMindBody`）
 */
export function applyCorporatePlayerGrowth(allTeams, { online = null } = {}) {
  const decayMult = (current, threshold, rate, floor = 0.10) => {
    if (current < threshold) return 1.0;
    return Math.max(floor, 1.0 - (current - threshold) * rate);
  };

  for (const [teamName, team] of Object.entries(allTeams)) {
    if (!team?.corporateData && !team?.independentLeagueId) continue;
    if (!team.players) continue;
    const natural = !!online?.has(teamName);

    const isClub = team.corporateData?.type === 'club';
    const isIndependent = !!team.independentLeagueId;
    // 独立リーグはキャンプがあるためクラブよりも環境が整っている → ランクC相当
    const rank = team.corporateData?.rank || (isIndependent ? 'C' : 'D');
    const rankMult = { S: 1.15, A: 1.05, B: 1.0, C: 0.90, D: 0.80 }[rank] || 1.0;

    // カテゴリごとの育成の性格（`CATEGORY_GROWTH`）。
    // 従来は3カテゴリすべてが同じ傾斜（長所×1.4 / 短所×0.7）だった。
    const prof = CATEGORY_GROWTH[natural ? 'online' : isClub ? 'club' : isIndependent ? 'independent' : 'corporate'];

    for (const player of team.players) {
      const { grow, age, discipline } = makeGrower(player, prof, rankMult);

      if (player.position === 'pitcher') {
        if (player.pitching) {
          player.pitching.control = grow(player.pitching.control, 'control');
          player.pitching.stamina = grow(player.pitching.stamina, 'stamina');
          const ypVelCatchup = getVelocityCatchupMult(player.physical?.arm || 50, player.pitching.velocity);
          player.pitching.velocity = grow(player.pitching.velocity, 'velocity',
            ypVelCatchup, getVelocityCap(player.physical?.arm || 50));
        }
        if (player.physical) {
          player.physical.arm = grow(player.physical.arm, 'armP');
        }
        // 変化球: 実戦で投げ込むほど精度が上がる。ストレートは対象外
        for (const pitch of (player.pitching?.arsenal || [])) {
          if (pitch.type === 'straight') continue;
          pitch.level = grow(pitch.level, 'breaking');
        }
        // 持ち球そのものが増えることもある（若いうちほど手を出す）
        if (age <= 28) tryLearnNewPitch(player, isClub ? 'club' : isIndependent ? 'independent' : 'corporate', discipline);
      } else {
        if (player.batting) {
          player.batting.meet = grow(player.batting.meet, 'meet');
          player.batting.power = grow(player.batting.power, 'power');
          player.batting.eye = grow(player.batting.eye, 'eye');
        }
        if (player.physical) {
          player.physical.speed = grow(player.physical.speed, 'speed');
          player.physical.arm = grow(player.physical.arm, 'arm');
        }
        if (player.fielding) {
          player.fielding.defense = grow(player.fielding.defense, 'defense');
        }
        if (player.position === 'catcher' && player.catching) {
          player.catching.lead = grow(player.catching.lead ?? 30, 'lead');
        }
      }
      if (natural) applyNaturalMindBody(player);

      // 知名度の蓄積。⚠ 以前は全員に毎年 0〜2（平均+1）を無条件に足しており、
      //    実績と関係なく在籍年数だけで社会人の知名度の中央値が 1→37（15年）まで積み上がった。
      //    ドラフト評価に fame×0.3 が乗るので、在籍年数がそのまま評価点になっていた。
      //    **試合に出ている選手だけ**が名前を知られ、出ていない選手は少しずつ忘れられる
      const seasonAct = seasonActivity(player);
      let fameGain = seasonAct >= 200 ? 1 + (Math.random() < 0.5 ? 1 : 0)
        : seasonAct >= 80 ? (Math.random() < 0.5 ? 1 : 0)
        : ((player.fame || 0) > 0 ? -1 : 0);
      if (isClub && discipline >= 65) {
        fameGain += Math.floor((discipline - 50) * 0.08);
      }
      player.fame = Math.max(0, Math.min(100, (player.fame || 0) + fameGain));
    }
  }
}

// `applyCorporatePlayerGrowth` が「基礎成長＋練習成長」で面倒を見る能力。
// ⚠ **年齢カーブと二重に掛けないこと**。社会人・独立・クラブの選手は
//    両方の関数を通るので、重なった能力に年齢カーブまで掛けると
//    衰退が二重になり、30代の選手が実際の倍の速さで落ちる。
//    残り（回復力・体力・盗塁・バント、および投手の打撃能力）は
//    corporate 側が触らないので、こちらが単独で担う。
const CORPORATE_OWNED_STATS = {
  pitcher: new Set(['control', 'stamina', 'velocity', 'arm']),
  fielder: new Set(['meet', 'power', 'eye', 'speed', 'arm', 'defense']),
};
// 大学生は `applyUniversityYear`（`universityPool.applyUniversityGrowth`）が見る能力。
// 社会人と同じ理由で年齢カーブと二重に掛けない
const UNIVERSITY_OWNED_STATS = {
  pitcher: new Set(['control', 'stamina', 'velocity', 'arm', 'bodyStamina', 'recovery']),
  fielder: new Set(['meet', 'power', 'eye', 'speed', 'arm', 'defense', 'bodyStamina', 'recovery']),
};

// --- 年齢カーブによる成長・衰退 ---
/**
 * @param opts.online オンラインの対人リーグの球団名（Set）。伸びる側だけ自然成長の倍率
 *   （`naturalPositive`: フィジカル厚め・技術薄め・若いほど）を掛ける。衰える側は同じ
 */
export function applyAgeCurveChanges(allTeams, { online = null } = {}) {
  const updatedTeams = {};
  const ageReports = [];

  Object.entries(allTeams).forEach(([teamName, team]) => {
    const natural = !!online?.has(teamName);
    // 社会人・独立・クラブは applyCorporatePlayerGrowth が年齢カーブごと担当する
    const corporateGrown = !!(team?.corporateData || team?.independentLeagueId);
    updatedTeams[teamName] = {
      ...team,
      players: team.players.map(player => {
        const age = player.age || 20;
        let updatedPlayer = JSON.parse(JSON.stringify(player));
        const changes = [];

        // 全能力について年齢カーブを適用
        const group = player.position === 'pitcher' ? 'pitcher' : 'fielder';
        const owned = corporateGrown ? CORPORATE_OWNED_STATS[group]
          : team?.universityData ? UNIVERSITY_OWNED_STATS[group]
          : null;
        const allStats = [...PHYSICAL_STATS, ...TECHNICAL_STATS]
          .filter(s => !owned || !owned.has(s));

        allStats.forEach(stat => {
          const isPhysical = PHYSICAL_STATS.includes(stat);
          const base = getAgeGrowthBase(age, isPhysical);

          // 個人差: 標準偏差2.0のランダム偏差（大きな個人差を出す）
          // Box-Muller変換で正規分布を生成
          const u1 = Math.random() || 0.001;
          const u2 = Math.random();
          const normalRandom = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          const variance = normalRandom * 1.0;

          // 才能依存の能力は年齢カーブでの成長も抑制（衰退方向は通常通り）
          const AGE_TALENT_MULT = { arm: 0.5, speed: 0.6, power: 0.8, velocity: 0.8 };
          const ageTalentMult = AGE_TALENT_MULT[stat] ?? 1.0;

          // 体幹/器用さによる成長方向の補正（成長方向のみ適用、衰退には影響しない）
          const physiqueMult = physiqueMultFor(player, stat);

          const effectiveRaw = (player.growthPotential ?? 1.0) + (player.growthModifier || 0);
          const growthPotential = Math.max(0, Math.min(1.8, effectiveRaw));
          // 衰退の加速は頭打ちにする（growthPotentialが加齢で大きくマイナスへ暴走しても
          // 際限なく急落させない）。上限1.9、係数0.27。
          const decayMult = Math.min(1.9, effectiveRaw < 0 ? 1 + Math.abs(effectiveRaw) * 0.27 : 1.0);

          // 衰退の緩和/促進: プロ意識(discipline)＋大事な起用(growthModifier)。
          //   プロ意識が高いほど練習で衰えを抑え、疲労状態での酷使(modifierマイナス)は
          //   衰えを促進する。プロ意識100＋大事に使われた選手が45歳前後まで一線を張れる
          //   バランス（DISC=0.44, CARE=2.0）。decayDiscMult は衰退量への乗数。
          const discipline = player.personality?.discipline ?? 50;
          const care = player.growthModifier || 0; // 正=大事に, 負=酷使
          const declineMitig = (discipline / 100) * 0.58 + care * 2.0;
          const decayDiscMult = Math.max(0.25, Math.min(1.5, 1.0 - declineMitig));

          // 最終変動値（四捨五入、±0の場合もある）
          let rawChange = base + variance;
          // 回復力は加齢で年々低下する（成長方向なし）。専用カーブで衰退のみ。
          if (stat === 'recovery') {
            rawChange = getRecoveryAgeBase(age) + variance * 0.5;
            if (rawChange > 0) rawChange = 0; // 上振れでも回復力は成長させない
          }
          // 成長方向: ポテンシャル + 体幹/器用さ補正（プロ意識は練習に集中）
          // 衰退方向: マイナスポテンシャルで加速 + プロ意識で緩和
          const naturalMult = natural ? naturalPositive(stat, age) : 1;
          let change = rawChange > 0
            ? Math.round(rawChange * ageTalentMult * growthPotential * physiqueMult * naturalMult)
            : Math.round(rawChange * decayMult * decayDiscMult);

          // 能力値を取得・更新
          const statPath = getStatPath(stat);
          if (!statPath) return;

          const currentValue = getNestedValue(updatedPlayer, statPath);
          if (currentValue == null) return;

          // フォーム別成長補正
          const formEff = PITCHING_FORM_EFFECTS[updatedPlayer.pitching?.form] || PITCHING_FORM_EFFECTS.threeQuarter;
          const formVelMult = stat === 'velocity' ? (formEff.velocityGrowthMult || 1.0) : 1.0;
          const formCtrlMult = stat === 'control' ? (formEff.controlGrowthMult || 1.0) : 1.0;

          // 球速は変動幅を1.2倍に（スケールが大きいため）+ フォーム補正 + 体幹補正
          if (stat === 'velocity') change = rawChange > 0
            ? Math.round(rawChange * 1.2 * ageTalentMult * growthPotential * formVelMult * physiqueMult)
            : Math.round(rawChange * 1.2 * decayMult * decayDiscMult);
          // 制球はフォーム補正適用（器用さ補正は既にchangeに適用済み）
          if (stat === 'control' && rawChange > 0) change = Math.round(change * formCtrlMult);
          // スタミナも変動幅を1.2倍（成長方向のみポテンシャル適用）
          if (stat === 'stamina') change = rawChange > 0
            ? Math.round(rawChange * 1.2 * growthPotential)
            : Math.round(rawChange * 1.2 * decayMult * decayDiscMult);

          // ⚠ **上限で止めること**。社会人・独立・クラブの選手は体力・回復力・盗塁・バントを
          //    ここだけで伸ばすので、止めないとオンラインの自然成長（体力×1.8）で体力が
          //    100を超えていた（10年の長期シミュで最大118）。上限は `STAT_GROWTH` の物差しと同じ
          const statCap = STAT_GROWTH[stat] ? STAT_GROWTH[stat].cap : 99;
          const newValue = change > 0 && statCap != null
            ? Math.max(1, Math.min(Math.max(statCap, currentValue), currentValue + change))
            : Math.max(1, currentValue + change);

          if (change !== 0) {
            updatedPlayer = setNestedValue(updatedPlayer, statPath, newValue);
            changes.push({
              stat, statName: getStatName(stat),
              before: currentValue, after: newValue, change
            });

            // 球速⇔肩力の連動
            if (stat === 'velocity') {
              const armChange = Math.round(change * 0.5);
              if (armChange !== 0) {
                const armPath = getStatPath('arm');
                const currentArm = getNestedValue(updatedPlayer, armPath);
                if (currentArm != null) {
                  const newArm = Math.max(1, Math.min(99, currentArm + armChange));
                  if (newArm !== currentArm) {
                    updatedPlayer = setNestedValue(updatedPlayer, armPath, newArm);
                    changes.push({ stat: 'arm', statName: getStatName('arm'), before: currentArm, after: newArm, change: newArm - currentArm });
                  }
                }
              }
            }
            if (stat === 'arm' && player.position !== 'pitcher') {
              const currentVelForCatchup = getNestedValue(updatedPlayer, getStatPath('velocity'));
              const velChange = Math.round(change * 0.5 * getVelocityCatchupMult(newValue, currentVelForCatchup || 120));
              if (velChange !== 0) {
                const velPath = getStatPath('velocity');
                const currentVel = currentVelForCatchup;
                if (currentVel != null) {
                  const newVel = Math.max(100, Math.min(getVelocityCap(newValue), currentVel + velChange));
                  if (newVel !== currentVel) {
                    updatedPlayer = setNestedValue(updatedPlayer, velPath, newVel);
                    changes.push({ stat: 'velocity', statName: getStatName('velocity'), before: currentVel, after: newVel, change: newVel - currentVel });
                  }
                }
              }
            }
          }
        });

        if (changes.length > 0) {
          ageReports.push({
            name: player.name, team: teamName, age, changes
          });
        }

        return updatedPlayer;
      })
    };
  });

  return { updatedTeams, ageReports };
}

// ============================================================
// 加齢によるポジション転向
//
// 現実では捕手が30代で一塁へ、遊撃が三塁へ、中堅が両翼へ移る。守備範囲と
// 肩が落ちた選手を同じ場所に置き続けられないからで、**守備の難易度には
// はっきりした序列がある**（`POSITION_GLOVE_WEIGHT` と同じ順序）。
//
// ⚠ 旧実装では加齢で `positionFitness` も `position` も動かず、
//    **34歳の遊撃手が遊撃を守り続けていた**。
// ⚠ **`lineupGenerator` と戦わないこと**。あちらは `positionFitness` を見て
//    打順の守備位置を決め、`p.position` を恒久的に上書きする。だからここでは
//    **適性そのものを動かす**——難しい場所の適性を落とし、移った先を上げる。
//    そうすれば編成側が自然に配置し直す。
// ============================================================

/** 守備位置ごとの要求水準（守備・走力）。序列は POSITION_GLOVE_WEIGHT と同じ */
const POSITION_DEMAND = {
  catcher: { def: 56, speed: 0 },
  short:   { def: 58, speed: 50 },
  center:  { def: 53, speed: 56 },
  second:  { def: 52, speed: 44 },
  third:   { def: 46, speed: 36 },
  right:   { def: 42, speed: 38 },
  left:    { def: 38, speed: 34 },
  first:   { def: 28, speed: 0 },
};
/** 転向先の候補（易しい方へ1段ずつ） */
const POSITION_LADDER = {
  catcher: ['first', 'third', 'left'],
  short:   ['third', 'second', 'left'],
  center:  ['right', 'left'],
  second:  ['third', 'first'],
  third:   ['first', 'left'],
  right:   ['left', 'first'],
  left:    ['first'],
  first:   [],
};
// これ未満は転向しない（衰えではなく編成の都合になってしまう）。
// ⚠ **ポジションごとに違う**。実データの転向年齢は 捕手32-35 / 遊撃30-33 /
//    中堅30-32。一律28にすると全ポジション中央29歳と早すぎた。
const CONVERT_AGE = { catcher: 32, short: 30, center: 30, second: 30,
                      third: 31, right: 31, left: 31 };
const CONVERT_RATE = 0.40;       // 条件を満たした年に転向する確率
const CONVERT_MARGIN = 5;        // 要求水準をこれだけ下回ったら転向を検討

/**
 * 加齢で守備範囲が落ちた選手を易しい守備位置へ移す。
 * 全カテゴリ（自チーム含む）が対象。年度替わりに1回だけ呼ぶこと。
 */
export function applyPositionShifts(allTeams) {
  const shifts = [];
  for (const [teamName, team] of Object.entries(allTeams || {})) {
    // ⚠ **捕手を枯渇させないこと**。捕手が2人を切ると `lineupGenerator` が
    //    適性30の外野手を捕手に置く（「守備位置と適正のズレ」の節と同じ症状）。
    const catcherCount = (team?.players || []).filter(p => p.position === 'catcher').length;
    let catchersLeft = catcherCount;
    for (const player of (team?.players || [])) {
      if (player.position === 'pitcher' || player.position === 'first') continue;
      const age = player.age || 25;
      if (age < (CONVERT_AGE[player.position] ?? 31)) continue;
      const demand = POSITION_DEMAND[player.position];
      if (!demand) continue;
      const def = player.fielding?.defense ?? 50;
      const speed = player.physical?.speed ?? 50;
      const shortOnDef = def < demand.def - CONVERT_MARGIN;
      const shortOnSpeed = demand.speed > 0 && speed < demand.speed - CONVERT_MARGIN;
      if (!shortOnDef && !shortOnSpeed) continue;
      if (Math.random() >= CONVERT_RATE) continue;
      if (player.position === 'catcher' && catchersLeft <= 2) continue;
      // 今の能力で務まる最初の転向先を探す
      const to = (POSITION_LADDER[player.position] || []).find(pos => {
        const d = POSITION_DEMAND[pos];
        return def >= d.def - CONVERT_MARGIN && (d.speed === 0 || speed >= d.speed - CONVERT_MARGIN);
      }) || (POSITION_LADDER[player.position] || [])[0];
      if (!to) continue;
      const from = player.position;
      if (from === 'catcher') catchersLeft--;
      player.position = to;
      if (player.positionFitness) {
        // 移った先はすぐ務まる（易しい方へ動くため）。元の場所の適性は落ちる
        player.positionFitness[to] = Math.max(player.positionFitness[to] ?? 30, 78);
        player.positionFitness[from] = Math.max(20, Math.round((player.positionFitness[from] ?? 100) * 0.75));
      }
      shifts.push({ teamName, name: player.name, age, from, to });
    }
  }
  return shifts;
}


// ============================================================
// プロ入り後の成長。**アマ側と同じ実行体（`makeGrower`）を使う**。
//
// ⚠ 旧実装（`npbCareer.applyAging`）は `growthPotential` だけで駆動しており、
//    **プロ意識も出場機会も見ていなかった**。24歳まで全能力に一律
//    `(2.6 - (age-18)×0.25) × gp` が乗るので、**指名された全員が一様に伸びて
//    一軍ラインを超える**（実測の一軍到達 86〜93%。実NPB 40〜50%）。
//    現実は逆で、大半の下位・育成指名は二軍で頭打ちになる。
//
// 一軍で出場すれば練習量が増え、二軍が続けば伸びない——という
// フィードバックが `activity` を通じて自然に働く。
// @param isFirstTeam 前年に一軍だったか
// ============================================================
export function applyNpbGrowth(player, isFirstTeam) {
  const prof = CATEGORY_GROWTH.npb;
  // 一軍は出場量が最大、二軍は控え相当。ここが「二軍暮らしは伸びない」の入口
  const activity = isFirstTeam ? 300 : 70;
  const { grow, age } = makeGrower(player, prof, 1.0, { activity });
  if (player.position === 'pitcher') {
    if (player.pitching) {
      player.pitching.control = grow(player.pitching.control, 'control');
      player.pitching.stamina = grow(player.pitching.stamina, 'stamina');
      const catchup = getVelocityCatchupMult(player.physical?.arm || 50, player.pitching.velocity);
      player.pitching.velocity = grow(player.pitching.velocity, 'velocity',
        catchup, getVelocityCap(player.physical?.arm || 50));
      for (const pitch of (player.pitching.arsenal || [])) {
        if (pitch.type === 'straight') continue;
        pitch.level = grow(pitch.level, 'breaking');
      }
    }
    if (player.physical) player.physical.arm = grow(player.physical.arm, 'armP');
  } else {
    if (player.batting) {
      player.batting.meet = grow(player.batting.meet, 'meet');
      player.batting.power = grow(player.batting.power, 'power');
      player.batting.eye = grow(player.batting.eye, 'eye');
      player.batting.steal = grow(player.batting.steal ?? 40, 'speed');
    }
    if (player.physical) {
      player.physical.speed = grow(player.physical.speed, 'speed');
      player.physical.arm = grow(player.physical.arm, 'arm');
    }
    if (player.fielding) player.fielding.defense = grow(player.fielding.defense, 'defense');
    // リードは経験で積み上がる（`STAT_GROWTH.lead` は decline 0）
    if (player.position === 'catcher' && player.catching) {
      player.catching.lead = grow(player.catching.lead ?? 40, 'lead');
    }
  }
  return age;
}
