// ============================================================
// スカウトの見積もり - scoutReport.js
// 選手の総合力の見積もり・スカウト精度で能力をぼかす・日付の差。
// 社会人のスカウト（corporate/scoutingSystem.js）と大学のスカウト
// （university/universityScout.js）の両方が使う（2026-11-24 に scoutingSystem.js から分けた）。
// ============================================================

/**
 * プールから選手の総合力を算出（スカウト候補のソート用）
 */
export function evaluatePlayerScore(player) {
  const isPitcher = player.position === 'pitcher';
  const gp = player.growthPotential || 1.0;

  let score;
  if (isPitcher) {
    const v = player.pitching?.velocity || 130;
    const c = player.pitching?.control || 40;
    const s = player.pitching?.stamina || 60;
    score = (v - 120) * 1.5 + c + s * 0.4;
  } else {
    const m = player.batting?.meet || 0;
    const p = player.batting?.power || 0;
    const spd = player.physical?.speed || 0;
    const def = player.fielding?.defense || 0;
    const arm = player.physical?.arm || 0;
    score = m + p + spd * 0.5 + def * 0.3 + arm * 0.3;
  }
  return score + (gp - 0.9) * 30;
}

/**
 * 能力値をスカウト精度に応じてぼかす
 * stage: 'primary'=概要のみ, 'secondary'=主要能力, 'full'=全能力
 */
export function obscureAbilities(player, accuracy, stage = 'full') {
  const blur = (val, maxVal = 99) => {
    const errorRange = Math.floor((100 - accuracy) / 5);
    const error = Math.floor(Math.random() * (errorRange * 2 + 1)) - errorRange;
    return Math.max(1, Math.min(maxVal, val + error));
  };
  const hidden = '?';

  const isPitcher = player.position === 'pitcher';

  const discipline = player.personality?.discipline ?? player.professionalism ?? 50;
  const mental = player.personality?.mental ?? 50;

  if (stage === 'primary') {
    // 概要: 全能力からランダムに2つだけ見える
    const pitcherKeys = ['velocity', 'control', 'stamina'];
    const hitterKeys = ['meet', 'power', 'eye', 'speed', 'defense'];
    const pool = isPitcher ? pitcherKeys : hitterKeys;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const visible = new Set(shuffled.slice(0, 2));

    return {
      batting: {
        meet: visible.has('meet') ? blur(player.batting?.meet || 0) : hidden,
        power: visible.has('power') ? blur(player.batting?.power || 0) : hidden,
        eye: visible.has('eye') ? blur(player.batting?.eye || 0) : hidden,
      },
      physical: {
        speed: visible.has('speed') ? blur(player.physical?.speed || 0) : hidden,
        arm: hidden,
        dexterity: hidden,
        recovery: hidden,
        bodyStamina: hidden,
      },
      fielding: {
        defense: visible.has('defense') ? blur(player.fielding?.defense || 0) : hidden,
      },
      pitching: {
        velocity: visible.has('velocity') ? blur(player.pitching?.velocity || 130, 165) : hidden,
        control: visible.has('control') ? blur(player.pitching?.control || 30) : hidden,
        stamina: visible.has('stamina') ? blur(player.pitching?.stamina || 60, 200) : hidden,
      },
      professionalism: hidden,
      mental: hidden,
    };
  }

  if (stage === 'secondary') {
    return {
      batting: {
        meet: blur(player.batting?.meet || 0),
        power: blur(player.batting?.power || 0),
        eye: isPitcher ? hidden : blur(player.batting?.eye || 0),
      },
      physical: {
        speed: isPitcher ? hidden : blur(player.physical?.speed || 0),
        arm: blur(player.physical?.arm || 0),
        dexterity: blur(player.physical?.dexterity || 50),
        recovery: hidden,
        bodyStamina: blur(player.physical?.bodyStamina || 50),
      },
      fielding: {
        defense: isPitcher ? hidden : blur(player.fielding?.defense || 0),
      },
      pitching: {
        velocity: blur(player.pitching?.velocity || 130, 165),
        control: blur(player.pitching?.control || 30),
        stamina: isPitcher ? blur(player.pitching?.stamina || 60, 200) : hidden,
      },
      professionalism: blur(discipline),
      mental: blur(mental),
    };
  }

  // full: 全能力を開示
  return {
    batting: {
      meet: blur(player.batting?.meet || 0),
      power: blur(player.batting?.power || 0),
      eye: blur(player.batting?.eye || 0),
    },
    physical: {
      speed: blur(player.physical?.speed || 0),
      arm: blur(player.physical?.arm || 0),
      dexterity: blur(player.physical?.dexterity || 50),
      recovery: blur(player.physical?.recovery || 50),
      bodyStamina: blur(player.physical?.bodyStamina || 50),
    },
    fielding: {
      defense: blur(player.fielding?.defense || 0),
    },
    pitching: {
      velocity: blur(player.pitching?.velocity || 130, 165),
      control: blur(player.pitching?.control || 30),
      stamina: blur(player.pitching?.stamina || 60, 200),
    },
    professionalism: blur(discipline),
    mental: blur(mental),
  };
}

export function dateDiffDays(d1Num, d2Num) {
  const y1 = Math.floor(d1Num / 10000), m1 = Math.floor((d1Num % 10000) / 100), day1 = d1Num % 100;
  const y2 = Math.floor(d2Num / 10000), m2 = Math.floor((d2Num % 10000) / 100), day2 = d2Num % 100;
  const a = new Date(y1, m1 - 1, day1);
  const b = new Date(y2, m2 - 1, day2);
  return Math.round((b - a) / 86400000);
}
