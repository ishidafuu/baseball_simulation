// ============================================================
// スカウトコメント - scoutComment.js
// 選手の特性・伸びしろ・目立つ能力から、スカウトのひとことを作る。
// （もとは tryoutSystem.js にあった。トライアウト・社会人の初期名簿・選手を作る部品が使う）
// ============================================================

/**
 * スカウトコメントテンプレート（特性別）
 */
const SCOUT_COMMENT_TEMPLATES = {
  // 野手特性
  speedster: [
    '俊足は天下一品。バント・盗塁で試合を動かせる選手に育てたい。',
    'とにかく足が速い。守備範囲の広い外野手として磨けば一線級になれる素材だ。',
    'この走力は独立リーグでは際立っている。打撃が育てば面白い。'
  ],
  slugger: [
    '打球の飛距離は将来性を感じさせる。ミートを鍛えればアーチを量産できるはず。',
    '粗削りだが、あの打球の強さは本物。あとは当てる技術だけだ。',
    '強いスイングが武器。制球眼を磨けば長距離砲になれる。'
  ],
  defender: [
    '守備は光る。肩の強さと安定感は他の候補者とは別格だ。',
    'グラブさばきが上手い。攻守のバランスを高めれば主力になれる。',
    '守りで試合を作れる選手だ。打撃が育てば理想の守備職人になれる。'
  ],
  contactHitter: [
    'バットコントロールが巧み。出塁率が高く、ラインナップに欠かせない存在になれる。',
    'ミートの精度が高い。選球眼を鍛えれば出塁マシンになれる原石だ。',
    '振り回さずしっかり当てる技術がある。打順の軸として活躍できそうだ。'
  ],
  eyeMaster: [
    '選球眼が素晴らしい。四球を稼げる選手は攻撃の起点になれる。',
    'ボール球に手を出さない冷静さがある。長打力が出れば面白い選手だ。',
    '見極めが抜群。長所を活かした打席を増やせれば化けそうだ。'
  ],
  baserunner: [
    '走塁センスが光る。バッティングが一人前になれば計算できる選手だ。',
    '塁上での判断力が良い。盗塁技術を磨けば相手チームの脅威になれる。',
    'スピードと判断力は独立リーグでも上位クラス。打撃が課題だ。'
  ],
  armStrong: [
    '肩の強さは一級品。外野からの矢のような返球は見ていて気持ちいい。',
    'この肩があれば外野はもちろん、右翼やサードでも使える可能性がある。',
    '強肩が光る。守備と打撃が整えば即戦力に近づける素材だ。'
  ],
  speedContact: [
    '俊足に加えてミートもなかなかある。磨けば上位打線を任せられる選手になれる。',
    '足も使えてバットもそこそこ。バランスが整ってきたら怖い選手だ。',
    '俊足巧打の素材。打撃をもう少し磨けばすぐに戦力計算できる。'
  ],
  powerArm: [
    '長打力と強肩を兼ね備えた外野手の素材。打撃の精度が上がれば大きい。',
    'パワーと肩が光る。バットコントロールさえ良くなれば主軸を任せたい。',
    '強肩強打の片鱗あり。荒削りだが将来性は十分ある選手だ。'
  ],
  // 投手特性
  fireballer: [
    'この球速は魅力。チェンジアップを覚えれば、緩急で三振が量産できる素材だ。',
    '球威は本物。変化球の精度を上げれば、打者は手こずるはずだ。',
    'ストレートで押せる力がある。あとは制球と変化球を磨くだけだ。'
  ],
  controlPitcher: [
    'コーナーへのコントロールが光る。球速を上げれば、打者は手も足も出ない。',
    '打者の内外角を丁寧につける投球術がある。球威があれば面白い存在だ。',
    '制球力は独立リーグでもトップクラス。あとは球威があればいうことなし。'
  ],
  ironman: [
    'スタミナは抜群。先発として長いイニングを任せたい素材だ。',
    '試合を通して安定して投げられる体力がある。技術面の成長が鍵だ。',
    '9回まで投げ切るタフネスがある。技術を磨けば安定感あるローテ投手になれる。'
  ],
  breakingBall: [
    '多彩な変化球が武器。制球が安定すれば、打者を翻弄できる投手になれる。',
    '変化球の種類が豊富。コントロールを磨けば面白い投手に育つ。',
    '曲がりの鋭い変化球がある。制球さえ安定すれば大きな武器になる。'
  ],
  sinkerballer: [
    'ゴロを打たせる技術がある。守備陣と連携して試合を作れる投手になれそうだ。',
    'バットの芯を外す投球ができる。制球とスタミナをさらに伸ばしたい素材だ。',
    '打ち取る術を持っている。守りのチームに合った投球スタイルだ。'
  ],
  strikeoutArtist: [
    '三振を取れる球威がある。変化球を覚えれば空振り量産型の投手になれる。',
    'もう一球種磨けば手がつけられない存在になれる。まだ磨かれていない原石だ。',
    '奪三振能力の片鱗を感じる。変化球を習得すれば一気に化ける素材だ。'
  ]
};

/**
 * 特性のコメントテンプレートが選手の実能力に合致するか判定
 * - 複数特性を持つ選手はgenerateAbilitiesで最大値が採用されるため、
 *   primaryTraitのコメントが実能力と矛盾することがある（例: controlPitcher+fireballer → 球速A）
 * - 本関数でコメントテンプレートの文言と実能力が矛盾しない特性だけを選ぶ
 * @returns {boolean} trait のテンプレート文言が player の実能力と整合するか
 */
function traitCommentMatches(trait, player) {
  const p = player.pitching || {};
  const b = player.batting || {};
  const ph = player.physical || {};
  const f = player.fielding || {};
  const arsenal = p.arsenal || [];
  const breakingBallCount = arsenal.filter(a => a.type !== 'straight').length;
  const hasSinkerType = arsenal.some(a => ['sinker', 'twoSeam', 'shoot', 'splitter'].includes(a.type));

  switch (trait) {
    // 投手特性
    case 'fireballer':
      // 「この球速は魅力」「球威は本物」→ 球速が高いこと
      return (p.velocity || 0) >= 140;
    case 'controlPitcher':
      // 「球速を上げれば打者は手も足も出ない」→ 制球が高く球速が足りないこと
      return (p.control || 0) >= 55 && (p.velocity || 0) < 140;
    case 'ironman':
      // 「スタミナは抜群」→ スタミナが高いこと
      return (p.stamina || 0) >= 85;
    case 'breakingBall':
      // 「多彩な変化球が武器」→ 変化球が複数あること
      return breakingBallCount >= 3;
    case 'sinkerballer':
      // 「ゴロを打たせる技術」→ 沈む系の球種を持ち、ある程度の制球があること
      return hasSinkerType && (p.control || 0) >= 50;
    case 'strikeoutArtist':
      // 「三振を取れる球威」「制球はまだ粗い」→ 球速が高く制球が不安定であること
      return (p.velocity || 0) >= 138 && (p.control || 0) < 58;
    // 野手特性
    case 'speedster':
      return (ph.speed || 0) >= 60;
    case 'slugger':
      return (b.power || 0) >= 55;
    case 'defender':
      return (f.defense || 0) >= 55;
    case 'contactHitter':
      return (b.meet || 0) >= 55;
    case 'eyeMaster':
      return (b.eye || 0) >= 55;
    case 'baserunner':
      return (ph.speed || 0) >= 50 && (b.steal || 0) >= 45;
    case 'armStrong':
      return (ph.arm || 0) >= 60;
    case 'speedContact':
      return (ph.speed || 0) >= 50 && (b.meet || 0) >= 50;
    case 'powerArm':
      return (b.power || 0) >= 50 && (ph.arm || 0) >= 50;
    default:
      return false;
  }
}

/**
 * スカウトコメントを生成
 * @param {Object} player - 選手データ（traits, position, batting, pitching, physical, fielding を含む）
 * @returns {{text: string, potentialHint: string, potentialLevel: number, talentHint: string}} スカウトコメント（構造化）
 *   potentialLevel: 5=最高, 4=高, 3=普通(表示なし), 2=低, 1=最低
 */
export function generateScoutComment(player) {
  const traits = player.traits || [];
  const gp = player.growthPotential || 1.0;

  let potentialHint = '';
  let potentialLevel = 3; // デフォルト: 普通（コメントなし）
  if (gp >= 1.35) {
    potentialHint = ['素材としては今年の目玉。大化けの予感がする。', '練習での吸収力が飛び抜けている。将来のスター候補だ。', 'ダイヤの原石。磨けばリーグを代表する選手になれる。'][Math.floor(Math.random() * 3)];
    potentialLevel = 5;
  } else if (gp >= 1.2) {
    potentialHint = Math.random() < 0.7 ? ['伸びしろは十分。成長次第で主力に化ける。', '練習への取り組み方を見ると、まだまだ伸びる印象だ。'][Math.floor(Math.random() * 2)] : '';
    potentialLevel = 4;
  } else if (gp <= 0.65) {
    potentialHint = Math.random() < 0.7 ? ['ただ、現状の能力がほぼ天井かもしれない。', '伸びしろという点では少し物足りない印象だ。'][Math.floor(Math.random() * 2)] : '';
    potentialLevel = 1;
  } else if (gp <= 0.8) {
    potentialHint = Math.random() < 0.4 ? '大きな成長を期待するより、即戦力として計算したい。' : '';
    potentialLevel = 2;
  }

  // 才能タイプのヒント（muscle/dexterityが高い場合のみ）
  const muscle = player.physical?.muscle || 50;
  const dext = player.physical?.dexterity || 50;
  let talentHint = '';
  if (muscle >= 70 && dext >= 70) {
    talentHint = '恵まれた体格に加え、手先の器用さも兼ね備えている。';
  } else if (muscle >= 70) {
    talentHint = ['恵まれた体格が目を引く。フィジカル面の成長が期待できる。', '体の強さは十分。パワー系の練習で大きく伸びる素材だ。'][Math.floor(Math.random() * 2)];
  } else if (dext >= 70) {
    talentHint = ['手先の器用さが光る。技術系の練習で伸びるタイプだ。', 'センスの良さを感じる。技術的な成長が早いだろう。'][Math.floor(Math.random() * 2)];
  } else if (muscle <= 35) {
    talentHint = Math.random() < 0.5 ? '線が細く、フィジカル面の上積みは厳しいかもしれない。' : '';
  } else if (dext <= 35) {
    talentHint = Math.random() < 0.5 ? '不器用な面があり、技術の習得に時間がかかるかもしれない。' : '';
  }

  const buildResult = (comment) => ({ text: comment, potentialHint, potentialLevel, talentHint });

  // 二刀流選手は専用コメントを生成
  if (player.isTwoWay) {
    const isPitcher = player.position === 'pitcher';
    const v = player.pitching?.velocity || 130;
    const meet = player.batting?.meet || 0;
    const power = player.batting?.power || 0;
    const speed = player.physical?.speed || 0;

    if (isPitcher) {
      const pitcherTwoWayComments = [
        '投手としての素材は十分。それに加えて打撃センスも光り、野手として育てる選択肢もある。',
        '投手だが、バットスイングの力強さが目を引く。二刀流で起用すれば面白い存在になれる。',
        'マウンドでの投球も魅力だが、打席での対応力が非凡。投打両面での活躍が期待できる。',
        '投手能力に加え、野手としてのポテンシャルも秘めている。使い方次第で大きな戦力になる。',
      ];
      if (v >= 145 && meet >= 45) return buildResult('速球派の投手でありながら打撃もプロ級。二刀流の逸材と言っていい。');
      if (v >= 140) return buildResult(pitcherTwoWayComments[Math.floor(Math.random() * pitcherTwoWayComments.length)]);
      if (meet >= 50 || power >= 45) return buildResult('投手としてはまだ発展途上だが、打撃の良さは光る。野手転向も視野に入る素材だ。');
      return buildResult(pitcherTwoWayComments[Math.floor(Math.random() * pitcherTwoWayComments.length)]);
    } else {
      const fielderTwoWayComments = [
        '野手としての打力が武器だが、マウンドに上がれば投手としても通用する腕を持っている。',
        '本職は野手だが、投手としても面白い。リリーフ起用で二刀流の真価を発揮できるタイプだ。',
        '打って投げて走れる万能型。投手としての起用も計算に入れられる貴重な存在だ。',
        '野手能力の高さに加え、投手経験も豊富。チーム事情に応じて柔軟に起用できる。',
      ];
      if (v >= 140 && (meet >= 50 || power >= 50)) return buildResult('打撃も投球も高水準。投手と野手、どちらでも一軍で勝負できる二刀流の逸材だ。');
      if (speed >= 55) return buildResult(fielderTwoWayComments[2]);
      return buildResult(fielderTwoWayComments[Math.floor(Math.random() * fielderTwoWayComments.length)]);
    }
  }

  // 実能力と合致する特性を優先して選ぶ（複数特性時の矛盾コメントを防止）
  for (const trait of traits) {
    const templates = SCOUT_COMMENT_TEMPLATES[trait];
    if (templates && traitCommentMatches(trait, player)) {
      return buildResult(templates[Math.floor(Math.random() * templates.length)]);
    }
  }

  // 特性なし or 実能力と合致する特性がなかった場合: 実能力ベースでコメントを生成
  const isPitcher = player.position === 'pitcher';
  if (isPitcher) {
    const v = player.pitching?.velocity || 130;
    const c = player.pitching?.control || 40;
    const s = player.pitching?.stamina || 60;
    const arsenal = player.pitching?.arsenal || [];
    const breakingBallCount = arsenal.filter(a => a.type !== 'straight').length;
    if (v >= 145 && c < 58) return buildResult('球速は魅力。制球が安定すれば打者を抑えられる素材だ。');
    if (v >= 145) return buildResult('球速は及第点以上。変化球と制球の精度次第で戦力になれる。');
    if (c >= 60 && v < 135) return buildResult('丁寧なピッチングができる。球威が増せば面白い存在になれる。');
    if (c >= 60) return buildResult('球の散らばりが少ない。持ち味を活かせば計算できる投手だ。');
    if (s >= 90) return buildResult('長いイニングを任せられる体力がある。技術を磨けばローテに入れる。');
    if (breakingBallCount >= 3) return buildResult('変化球の引き出しは多い。制球が整えば打者を翻弄できる。');
    return buildResult('平均的な能力だが、真摯に練習に取り組む姿勢が見えた。伸びしろに期待する。');
  } else {
    const meet = player.batting?.meet || 0;
    const power = player.batting?.power || 0;
    const eye = player.batting?.eye || 0;
    const speed = player.physical?.speed || 0;
    const defense = player.fielding?.defense || 0;
    const arm = player.physical?.arm || 0;
    const maxStat = Math.max(meet, power, eye, speed, defense, arm);
    if (maxStat === speed && speed >= 50) return buildResult('俊足が光る。守備範囲を広げて打撃を磨けば戦力になれる。');
    if (maxStat === meet && meet >= 45) return buildResult('バットコントロールがある。打撃の精度を磨けば計算できる選手だ。');
    if (maxStat === power && power >= 40) return buildResult('打球の飛距離は魅力的。当てる技術が身につけば大きな武器になる。');
    if (maxStat === eye && eye >= 50) return buildResult('選球眼に光るものがある。出塁率を稼げる打者に育てたい。');
    if (maxStat === defense && defense >= 50) return buildResult('守備の安定感がある。攻撃面を鍛えれば即戦力に近づける。');
    if (maxStat === arm && arm >= 50) return buildResult('肩の強さが光る。守備位置の適性を活かして育てたい。');
    return buildResult('全体的に粗削りだが、真面目な取り組みが見えた。時間をかけて育てたい素材だ。');
  }
}
