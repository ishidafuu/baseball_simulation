// 年代記の文（PC・スマホ）。⚠ アプリ（`mobile/.../Chronicle.kt`）と同じ文にすること。
// ⚠ 決着の文はオフの手続きの間も出るので、時期によらない形にする（「プレーオフに臨む」と書かない）
// 数字はサーバー（`server/chronicle.mjs`）が作る。ここは文にするだけ。

/** 優勝・昇格・残留のマジックと決定。`short`: 球団の短い名前 */
export function raceText(r, short = (n) => n) {
  if (!r?.team) return null;
  const t = short(r.team);
  const rival = r.rival ? short(r.rival) : null;
  const tail = rival
    ? `${t}の勝ちと${rival}の負けを合わせて${r.magic}で決まる（残り${r.left}試合）。`
    : '';
  switch (r.kind) {
    case 'first':
      return r.clinched
        ? { head: `${t}、${r.leagueName}1位が決定`, body: 'レギュラーシーズン1位の座を手にした。' }
        : { head: `${t}、${r.leagueName}1位へマジック${r.magic}`, body: tail };
    case 'promotion':
      return r.clinched
        ? { head: `${t}、${r.leagueName}優勝で昇格が決定`, body: '来季は1部で戦う。' }
        : { head: `${t}、昇格へマジック${r.magic}`, body: tail };
    case 'survive':
      return r.clinched
        ? { head: `${t}、${r.leagueName}残留が決定`, body: '降格圏から抜け出した。' }
        : { head: `${t}、残留へマジック${r.magic}`, body: tail };
    case 'relegated':
      return { head: `${t}、2部降格が決定`, body: '来季は2部から出直す。' };
    default:
      return null;
  }
}

/** 節目（「通算100安打に到達」） */
export function milestoneText(m) {
  return m.kind === 'career' ? `${m.label}に到達（このリーグで）` : `${m.label}に到達`;
}

/** 裏の大会（甲子園・独立リーグ日本一決定戦） */
export function worldText(w, short = (n) => n) {
  if (w?.kind === 'koshien') {
    const star = w.star
      ? `大会の顔は${w.star.school}の${w.star.role}・${w.star.name}（${w.star.stageLabel}）。`
      : '';
    return {
      head: `夏の甲子園、${w.champion}${w.championPref ? `（${w.championPref}）` : ''}が優勝`,
      body: `${w.runnerUp ? `準優勝は${w.runnerUp}。` : ''}${star}この世代から、いずれトライアウトに名前が出てくるかもしれない。`,
    };
  }
  if (w?.kind === 'grand') {
    const ours = w.ours
      ? `このリーグの代表${short(w.ours)}は${w.oursResult || '出場'}${w.oursLostTo ? `（${w.oursLostTo}に敗れた）` : ''}。`
      : '';
    return {
      head: `独立リーグ日本一は${w.champion}${w.championLeague ? `（${w.championLeague}）` : ''}`,
      body: `各地の独立リーグの王者${w.teams ? `${w.teams}球団` : ''}が争った決定戦。${w.finalScore ? `決勝は${w.finalScore}。` : ''}${ours}`,
    };
  }
  return null;
}

/**
 * 年間表彰の行（`view.chronicle.honors`。サーバー `seasonAwards.mjs` の `honorsView`）。
 * タイトル（リーグ全体）と、部ごとの MVP・新人王・最優秀バッテリー・ベストナイン。
 * @returns {{ head: string, body: string }[]}
 */
/**
 * プロでのその後の行（球団史は全部の年 `career`、リーグ全体はいちばん新しい年 `after`）。
 * ⚠ アプリ（`Chronicle.kt` の `proDraftedAfter`）と同じ
 */
export const proDraftedAfter = (r) => (r?.career?.length ? r.career : r?.after ? [r.after] : []);

export function honorRows(h, short = (n) => n) {
  if (!h) return [];
  const who = (x) => `${x.name}（${short(x.team)}）`;
  const rows = [];
  if (h.titles?.length)
    rows.push({
      head: 'タイトル',
      body: h.titles.map((t) => `${t.label} ${who(t)}${t.line ? ` ${t.line}` : ''}`).join('、'),
    });
  for (const l of h.leagues || []) {
    if (l.mvp) rows.push({ head: `${l.league} MVP`, body: `${who(l.mvp)} ${l.mvp.line}` });
    if (l.rookie) rows.push({ head: `${l.league} 新人王`, body: `${who(l.rookie)} ${l.rookie.line}` });
    if (l.battery)
      rows.push({
        head: `${l.league} 最優秀バッテリー`,
        body: `${l.battery.pitcher}・${l.battery.catcher}（${short(l.battery.team)}） ${l.battery.line}`,
      });
    if (l.bestNine?.length)
      rows.push({
        head: `${l.league} ベストナイン`,
        body: l.bestNine.map((x) => `${x.label} ${who(x)}`).join('、'),
      });
  }
  return rows;
}
