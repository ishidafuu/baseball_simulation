// ============================================================
// 指導者（監督・コーチ）の画面用の形。PC・スマホ・アプリが同じ文を出すよう、
// 説明の文はここ（サーバー）で作る（「PC/アプリ同文」）。
//
// 保存の形は `coachEngine.mjs`、考え方の計算は `src/online/coaches.js`。
// ============================================================
import {
  COACH_ROLES,
  ROLE_LABELS,
  STAFF_AREAS,
  STAFF_AREA_KEYS,
  STAFF_MODES,
  coachColor,
  visionHeadline,
  visionText,
  growthLabel,
  preferenceText,
  pitchText,
  keyPlayers,
  personalityText,
  viewScale,
  personalityScale,
  originText,
  delegationOf,
  staffModesOf,
  shortName,
  PHASE_STAFF_AREA,
  roleTypeLabel,
  isAuto,
} from '../src/online/coaches.js';
import { PYRAMID_LEAGUES } from '../src/online/pyramidLeague.js';
import {
  staffOf,
  teamTacticsFor,
  effectiveStaffModes,
  areaMode,
  seatEmpty,
  AMBITION_LABELS,
  PATIENCE_LABELS,
  conflictOf,
  RIFT_CONFLICT,
  CONFLICT_AREAS,
} from './coachEngine.mjs';

const tierOf = (leagueId) =>
  PYRAMID_LEAGUES.find((l) => l.id === leagueId)?.tier ?? null;
/** 1部で1位の年（通算の「1部優勝」と称号で同じ物差し） */
const isPennant = (r) => r.rank === 1 && tierOf(r.league) === 0;

/** 任せ度の言葉（監督だけ）。ワンマン 0%〜任せる 100% */
export function delegationText(coach) {
  const w = delegationOf(coach);
  if (w === 0) return 'ワンマン（任せ度0%）';
  if (w === 1) return 'コーチに任せる（任せ度100%）';
  return `任せ度${Math.round(w * 100)}%`;
}

const pct = (w, l) => (w + l > 0 ? (w / (w + l)).toFixed(3).replace(/^0/, '') : '-');

/**
 * 通算（監督として・コーチとして を分けて数える）。
 * 監督: 年数・勝敗・1部優勝・プレーオフ優勝・昇格・降格。コーチ: 投手・野手ごとの年数。
 */
export function careerSummary(coach) {
  const rows = coach.career || [];
  const managed = rows.filter((r) => r.role === 'manager');
  const sum = (list, key) => list.reduce((n, r) => n + (r[key] || 0), 0);
  const manager = managed.length
    ? {
        years: managed.length,
        wins: sum(managed, 'wins'),
        losses: sum(managed, 'losses'),
        draws: sum(managed, 'draws'),
        pennants: managed.filter(isPennant).length,
        champions: managed.filter((r) => r.champion).length,
        promotions: managed.filter((r) => r.move === 'up').length,
        relegations: managed.filter((r) => r.move === 'down').length,
      }
    : null;
  const coachYears = (role) => rows.filter((r) => r.role === role).length;
  const lines = [];
  if (manager) {
    const extras = [
      manager.pennants ? `1部優勝${manager.pennants}回` : null,
      manager.champions ? `プレーオフ優勝${manager.champions}回` : null,
      manager.promotions ? `昇格${manager.promotions}回` : null,
    ].filter(Boolean);
    lines.push(
      `監督 ${manager.years}年 ${manager.wins}勝${manager.losses}敗${manager.draws ? `${manager.draws}分` : ''}（勝率${pct(manager.wins, manager.losses)}）${extras.length ? `・${extras.join('・')}` : ''}`,
    );
  }
  for (const role of ['pitching', 'batting']) {
    const years = coachYears(role);
    if (years) lines.push(`${ROLE_LABELS[role]} ${years}年`);
  }
  return {
    manager,
    pitchingYears: coachYears('pitching'),
    battingYears: coachYears('batting'),
    text: lines.length ? lines.join(' / ') : '指導者としての記録はまだ無い',
  };
}

/**
 * 称号（通算の記録から自動で付ける。カードを見た瞬間に人物が分かるように。最大2つ）。
 * 部で1位だった成績は年度更新で行に印を付けてある（`leads`。`coachEngine.mjs` の `LEAD_STATS`）。
 * ⚠ 説明だけで、効果は無い。レビューの「あとで足せる案」（いしだ「重くなければ入れて」2026-11-10）。
 * `summary` は `careerSummary(coach)`（カードで作ったものを使い回す）。
 */
export function coachTitles(coach, summary = careerSummary(coach)) {
  const rows = coach?.career || [];
  const leads = (role, stat) => rows.filter((r) => r.role === role && r.leads?.includes(stat)).length;
  const managed = rows.filter((r) => r.role === 'manager');
  const m = summary.manager;
  // 再建屋: 同じ球団で、部の4位以下から、のちに同じ部で2位以内か上の部まで引き上げた
  // （⚠ 降格した先の部で2位は数えない）
  const level = (r) => tierOf(r.league) ?? 9;
  const rebuilt = managed.some(
    (r, i) =>
      r.rank >= 4 &&
      managed
        .slice(i + 1)
        .some((later) => later.team === r.team && (level(later) < level(r) || (level(later) === level(r) && later.rank <= 2))),
  );
  return [
    // 1部優勝かプレーオフ優勝の年が2度（同じ年の両方は1度に数える）
    managed.filter((r) => r.champion || isPennant(r)).length >= 2 && '優勝請負人',
    rebuilt && '再建屋',
    m && m.years >= 8 && m.wins / Math.max(1, m.wins + m.losses) >= 0.55 && '名将',
    leads('manager', 'stolenBases') >= 2 && '走る野球の人',
    leads('manager', 'homeruns') >= 2 && '大砲野球の人',
    leads('manager', 'era') >= 2 && '投手王国の主',
    leads('pitching', 'era') >= 2 && '投手陣の名伯楽',
    leads('batting', 'runs') >= 2 && '打線の名伯楽',
    (coach?.fired || 0) >= 2 && '苦労人',
  ]
    .filter(Boolean)
    .slice(0, 2);
}

/** 年ごとの履歴の1行（新しい順）。役職ごとに見る数字を変える */
function historyRows(coach, labelOf) {
  return [...(coach.career || [])].reverse().map((r) => {
    const place =
      r.rank != null
        ? `${tierOf(r.league) === 0 ? '1部' : tierOf(r.league) === 1 ? '2部' : ''}${r.rank}位`
        : '';
    const marks = [
      r.champion ? 'プレーオフ優勝' : null,
      r.move === 'up' ? '昇格' : r.move === 'down' ? '降格' : null,
    ].filter(Boolean);
    const numbers =
      r.role === 'pitching'
        ? [
            r.era != null ? `防御率${r.era.toFixed(2)}` : null,
            `失点${r.allowed ?? '-'}`,
            r.strikeouts != null ? `奪三振${r.strikeouts}` : null,
            r.walks != null ? `四球${r.walks}` : null,
          ]
        : r.role === 'batting'
          ? [
              r.average != null ? `打率${r.average.toFixed(3).replace(/^0/, '')}` : null,
              `得点${r.runs ?? '-'}`,
              r.homeruns != null ? `本塁打${r.homeruns}` : null,
              r.stolenBases != null ? `盗塁${r.stolenBases}` : null,
            ]
          : [`${r.wins}勝${r.losses}敗${r.draws ? `${r.draws}分` : ''}`];
    return {
      year: r.year,
      team: r.team,
      teamLabel: labelOf(r.team),
      role: r.role,
      roleLabel: ROLE_LABELS[r.role],
      text: [place, ...numbers.filter(Boolean), ...marks].filter(Boolean).join(' '),
    };
  });
}

/**
 * 指導者カード（画面の1人ぶん）。`full` なら考え方の目盛り・履歴まで。
 */
export function coachCard(league, coach, labelOf, { full = true, roster = null } = {}) {
  if (!coach) return null;
  const summary = careerSummary(coach);
  const job = coach.job;
  const mentor = coach.mentor ? league.coaches?.people?.[coach.mentor] : null;
  const card = {
    id: coach.id,
    name: coach.name,
    age: coach.age,
    role: job?.role || null,
    roleLabel: job ? ROLE_LABELS[job.role] : '浪人中',
    team: job?.team || null,
    since: job?.since ?? null,
    // ⚠ 「得意」は画面に出さない（いしだ指摘 2026-11-10: 最初の3人は席と同じものが得意に
    //    決め打ちなので、出しても意味が無い）。中では看板の決まりやすさと空席埋めに効く
    specialty: coach.specialty,
    origin: originText(coach),
    fromPlayer: coach.origin?.kind === 'player',
    legend: !!coach.origin?.legend,
    // 紙面の言葉（「機動力と継投の野球」）
    color: coachColor(coach),
    // カードの表の3行: ビジョン・育成観・性格（いしだ案のビジョン。考え方の目盛りは「詳しく」へ）
    headline: visionHeadline(coach),
    vision: visionText(coach, job?.role),
    growth: growthLabel(coach),
    personality: personalityText(coach),
    titles: coachTitles(coach, summary),
    // ⚠ 任せ度は監督の席にいる人だけ意味がある（コーチの間は使わない）
    delegation: job?.role === 'manager' ? delegationText(coach) : null,
    career: summary.text,
  };
  if (!full) return card;
  return {
    ...card,
    // 売り込みの文（本人の言葉）。市場で選ぶときの判断材料
    pitch: pitchText(coach, { year: league.season?.year ?? null }),
    // 軸にする選手（監督の席の人だけ。効果は無く説明だけ）
    keyPlayers:
      job?.role === 'manager' && roster?.length
        ? keyPlayers(coach, roster).map((p) => p.name).join('・')
        : null,
    views: viewScale(coach),
    traits: personalityScale(coach),
    prefs: preferenceText(coach),
    playerLine: coach.origin?.line || null,
    mentor: mentor ? mentor.name : null,
    history: historyRows(coach, labelOf).slice(0, 12),
  };
}

/**
 * 采配の1行の文。
 * - 指導者が変えた: 「送りバント: AI判断 → 積極的（山田監督）」
 * - 指導者も標準のまま: 「代打を使い始める回: AI判断（山田監督も標準）」
 * - 指導者が決めない（人が決めた・任せていない）: 「送りバント: しない」
 */
function tacticText({ setting, ...line }) {
  const settingLabel = line.settingLabel;
  if (!line.by) return { ...line, text: `${line.label}: ${settingLabel}` };
  const resolved = line.isStandard ? '標準' : line.valueLabel;
  return {
    ...line,
    resolvedLabel: resolved,
    text: line.isStandard && isAuto(line.key, setting)
      ? `${line.label}: ${settingLabel}（${line.by}も標準）`
      : resolved === settingLabel
        ? `${line.label}: ${resolved}（${line.by}）`
        : `${line.label}: ${settingLabel} → ${resolved}（${line.by}）`,
  };
}

/**
 * 采配の内訳（実際に動く中身と、決めた人）。
 * ⚠ `team` は保存した球団（`league.game.teams[name]`）
 */
export function tacticsLines(league, teamName, team) {
  const { lines } = teamTacticsFor(league, teamName, team);
  return lines.map((line) =>
    tacticText({
      field: line.field,
      key: line.key,
      label: line.label,
      setting: line.setting,
      settingLabel: line.settingLabel,
      valueLabel: line.valueLabel,
      isStandard: isAuto(line.key, line.value),
      by: line.by,
    }),
  );
}

const hireNote = (event) =>
  event.mentor
    ? `。恩師・${event.mentor}監督の下へ`
    : event.homecoming
      ? event.role === 'manager'
        ? '。古巣で初の監督'
        : '。古巣に戻る'
      : '';

/** 出来事の1行の文（紙面と画面で同じ） */
export function coachEventText(event, labelOf) {
  const team = event.team ? labelOf(event.team) : '';
  const role = event.role ? ROLE_LABELS[event.role] : '';
  switch (event.kind) {
    case 'retire':
      return `${team}の${event.name}${role}が勇退（${event.age}歳）`;
    case 'fire':
      return `${team}が${event.name}監督を解任${event.reason ? `（${event.reason}）` : ''}`;
    case 'resign':
      return `${team}の${event.name}${role}が辞任${event.reason ? `（${event.reason}）` : ''}`;
    case 'turn':
      return `${team}の${event.name}が現役を引退し、指導者の道へ`;
    case 'hire':
      return `${team}の${role}に${event.name}${event.from === 'player' ? '（元選手）' : ''}が就任${hireNote(event)}`;
    case 'promote':
      return `${team}の${event.name}が監督に昇格${event.homecoming ? '。古巣で初の監督' : ''}`;
    case 'release':
      return `${team}が${event.name}${role}を解任`;
    default:
      return '';
  }
}

export function coachEventsView(league, labelOf, { limit = 12, team = null } = {}) {
  return (league.coaches?.events || [])
    .filter((e) => !team || e.team === team)
    .slice(0, limit)
    .map((e) => ({
      year: e.year,
      kind: e.kind,
      team: e.team || null,
      role: e.role || null,
      coachId: e.coachId,
      name: e.name,
      ...(e.mentor ? { mentor: e.mentor } : {}),
      ...(e.homecoming ? { homecoming: true } : {}),
      ...(e.reason ? { reason: e.reason } : {}),
      text: coachEventText(e, labelOf),
    }));
}

/**
 * 球団の3つの席（カードつき）。`roster` を渡せば監督のカードに軸の選手を出す
 * （自分の球団とCPU球団だけ。人の球団の編成は他の人に見せない）
 */
function seatsView(league, teamName, labelOf, { roster = null } = {}) {
  const staff = staffOf(league, teamName);
  return COACH_ROLES.map((role) => ({
    role,
    roleLabel: ROLE_LABELS[role],
    coach: coachCard(league, staff[role], labelOf, { roster }),
  }));
}

/** 球団の期待と我慢強さ（固定値。CPUの監督の進退に使う） */
function frontView(league, teamName) {
  const f = league.coaches?.fronts?.[teamName];
  if (!f) return null;
  return {
    ambition: AMBITION_LABELS[f.ambition] || '',
    patience: PATIENCE_LABELS[f.patience] || '',
  };
}

/**
 * 自分の球団の指導者の画面（`view.staff`）。
 * - 席（3人）・任せ方（分野ごと）・采配の内訳・球団の期待
 * - キャンプの間は市場（呼べる人）と、席を動かせる印
 */
export function ownStaffView(league, member, team, labelOf) {
  if (!league.coaches) return null;
  const saved = staffModesOf(member);
  const effective = effectiveStaffModes(league, member);
  const staff = staffOf(league, member.teamName);
  const camp = league.phase?.kind === 'camp';
  return {
    seats: seatsView(league, member.teamName, labelOf, { roster: team?.players }),
    modeOptions: Object.entries(STAFF_MODES).map(([value, label]) => ({ value, label })),
    modes: STAFF_AREA_KEYS.map((key) => {
      const owner = STAFF_AREAS[key].owner;
      const empty = seatEmpty(league, member.teamName, key);
      return {
        key,
        label: STAFF_AREAS[key].label,
        mode: saved[key],
        effective: effective[key],
        effectiveLabel: STAFF_MODES[effective[key]],
        owner,
        ownerLabel: owner ? ROLE_LABELS[owner] : key === 'camp' ? '投手コーチ・野手コーチ' : '監督・コーチ（項目ごと）',
        // ⚠ 受け持ちの席が空いていれば「自分で」しか選べない（いしだ指定）
        locked: empty,
        note: empty ? `${owner ? ROLE_LABELS[owner] : '指導者'}がいないため自分で決めます` : null,
      };
    }),
    tactics: tacticsLines(league, member.teamName, team),
    front: frontView(league, member.teamName),
    canEditSeats: camp,
    market: camp
      ? Object.values(league.coaches.people)
          .filter((p) => p.status === 'free')
          .sort((a, b) => (b.origin?.kind === 'player') - (a.origin?.kind === 'player') || a.age - b.age || a.id.localeCompare(b.id))
          .map((p) => coachCard(league, p, labelOf))
      : [],
    events: coachEventsView(league, labelOf, { limit: 8, team: member.teamName }),
    // 監督とコーチの考えが割れている（強さには効かない。紙面の話題と、年度更新の辞任の目安）
    rifts: ['pitching', 'batting']
      .filter((role) => conflictOf(staff.manager, staff[role], role) >= RIFT_CONFLICT)
      .map((role) => ({
        role,
        text: `${shortName(staff.manager)}監督と${shortName(staff[role])}${ROLE_LABELS[role]}、${CONFLICT_AREAS[role]}をめぐり考えが割れている`,
      })),
  };
}

/**
 * 手続きの標準案を出した指導者（`phase.planBy`）。任せ方が「自分で」（または席が空き）なら null。
 * トライアウト・退団は監督、キャンプは投手コーチ・野手コーチ。
 * ⚠ **キャンプは監督の名前を出さない**。人の球団のキャンプは、コーチの居ない側を監督で
 *    埋めず「おすすめ」で練習する（`coaches.js` の `campPlan` の `strictSeats`）。
 *    コーチが2人とも居なければ案は無い（null）
 * ⚠ キャンプは「決定」ではなく1クールずつ実行する。文もそれに合わせる
 * ⚠ 任せた手続きはその人の決定を待たない（`leagueEngine` の `waitsFor`）。「任せる」の文はそれを書く。
 *    キャンプは人事ができる期間でもあるので、ほかの球団が終えると終わることも書く
 */
export function phasePlanBy(league, teamName, kind) {
  const area = PHASE_STAFF_AREA[kind];
  if (!area || !league.coaches) return null;
  const mode = areaMode(league, teamName, area);
  if (mode === 'self') return null;
  const staff = staffOf(league, teamName);
  const names =
    area === 'camp'
      ? [
          staff.pitching ? `${shortName(staff.pitching)}投手コーチ` : null,
          staff.batting ? `${shortName(staff.batting)}野手コーチ` : null,
        ].filter(Boolean)
      : [];
  if (!names.length && staff.manager && area !== 'camp')
    names.push(`${shortName(staff.manager)}監督`);
  if (!names.length) return null;
  const by = names.join('・');
  const text =
    area === 'camp'
      ? mode === 'delegate'
        ? `${by}に任せています。あなたを待たずに、ほかの球団が4クール終えるとキャンプが終わり、残りのクールは指導者の方針で回ります（指導者の入れ替えはそれまでに。自分でクールを回すと、任せ方は「意見を聞く」に戻ります）`
        : `${by}の案です。変えてから練習を実行できます（回さなかったクールはこの案で）`
      : mode === 'delegate'
        ? `${by}に任せています。あなたの決定は待たずに、指導者の案で決まります（自分で決めるときは任せ方を「意見を聞く」に）`
        : `${by}の案です。変えてから決定できます`;
  return { mode, by, text };
}

/**
 * 一覧の1人ぶん。`color` は監督なら「機動力と継投の野球」、コーチなら受け持ちの型
 * （投手コーチは守りの型、野手コーチは攻めの型。コーチの間はその側だけが効く）
 */
const brief = (coach, role = 'manager') => ({
  name: coach.name,
  // 紙面の呼び名（「山田監督」）
  shortName: shortName(coach),
  color: roleTypeLabel(coach, role) || coachColor(coach),
});

/** リーグ全球団の指導者の一覧（順位表の横や「指導者」ページの他球団の欄。軽い形） */
export function leagueStaffView(league, labelOf) {
  if (!league.coaches) return null;
  return {
    teams: (league.season.settings.teamNames || []).map((name) => {
      const staff = staffOf(league, name);
      return {
        team: name,
        teamLabel: labelOf(name),
        manager: staff.manager
          ? {
              ...brief(staff.manager),
              delegation: delegationText(staff.manager),
              // 監督としての通算勝利（今季ぶんを足す。紙面の「通算100勝」）
              totalWins:
                (careerSummary(staff.manager).manager?.wins || 0) +
                ((league.season.standings || []).find((s) => s.team === name)?.wins || 0),
              // 今季からの監督（紙面の「新体制」）
              isNew: staff.manager.job?.since === league.season.year,
            }
          : null,
        pitching: staff.pitching ? brief(staff.pitching, 'pitching') : null,
        batting: staff.batting ? brief(staff.batting, 'batting') : null,
      };
    }),
    events: coachEventsView(league, labelOf, { limit: 12 }),
  };
}

/**
 * 他球団の指導者（`projectTeamInfo`）。カードは全部見せる。
 * ⚠ **采配の内訳はCPU球団だけ**。人の球団の采配・編成は他の人に見せない
 *    （`projectTeamInfo` は今の起用だけ出し、方針・作戦を含めない決まり）。
 */
export function teamStaffView(league, teamName, team, labelOf) {
  if (!league.coaches) return null;
  const human = (league.members || []).some((m) => m.teamName === teamName);
  return {
    seats: seatsView(league, teamName, labelOf, { roster: human ? null : team?.players }),
    front: human ? null : frontView(league, teamName),
    tactics: human ? null : tacticsLines(league, teamName, team),
    events: coachEventsView(league, labelOf, { limit: 6, team: teamName }),
  };
}
