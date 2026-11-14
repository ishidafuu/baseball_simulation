package jp.icenorth.baseball.shared

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * サーバー（server/projection.mjs の projectLeague）が返すビューのうち、アプリが使う部分。
 *
 * ⚠ **知らない項目は捨てる（ignoreUnknownKeys）が、編成（lineup）だけは JsonObject のまま持つ**。
 *    保存は「編成の塊を丸ごと送り返す」形なので、アプリが知らない項目（投手の役割・自動采配など）を
 *    落とすと、保存した瞬間に Web 側で決めた設定が消える。
 */
@Serializable
data class LeagueView(
    val setupRequired: Boolean = false,
    val schema: Int? = null,
    val revision: Int = 0,
    val status: String? = null,
    val teamName: String? = null,
    val year: Int? = null,
    val useDH: Boolean = false,
    val currentDate: GameDate? = null,
    val seasonTurns: Int = SEASON_TURNS,
    val nextAdvanceAt: String? = null,
    val phaseDeadline: String? = null,
    val isAdmin: Boolean = false,
    val writable: Boolean = false,
    val teamLabels: Map<String, TeamLabel> = emptyMap(),
    val teamLeagues: Map<String, String> = emptyMap(),
    val members: List<Member> = emptyList(),
    /** 人が持っている球団 → その人の呼び名（球団名と同じときは空。CPUの球団は載らない） */
    val teamOwners: Map<String, String> = emptyMap(),
    val standings: List<Standing> = emptyList(),
    /** 球団ごとの今の連勝・連敗（server/projection.mjs teamStreaks）。古いサーバーには無い */
    val teamStreaks: Map<String, TeamStreak> = emptyMap(),
    val results: List<GameResult> = emptyList(),
    /** 自球団の直近5試合（古い順。server/projection.mjs の ownRecentGames）。試合結果の通知に使う */
    val recentGames: List<OwnGame> = emptyList(),
    val nextGames: List<ScheduledGame> = emptyList(),
    val roster: List<Player> = emptyList(),
    val lineup: JsonObject? = null,
    val phase: Phase? = null,
    val pendingPack: JsonObject? = null,
    /** 優勝・昇格・残留のマジックと決定（server/chronicle.mjs leagueRaces）。古いサーバーには無い */
    val races: List<Race> = emptyList(),
    /** 節目の記録・引退・裏の大会（server/chronicle.mjs chronicleView）。古いサーバーには無い */
    val chronicle: ChronicleView = ChronicleView(),
    /** 自分の球団の指導者と任せ方（server/coachView.mjs ownStaffView）。古いサーバーには無い */
    val staff: StaffView? = null,
    /** リーグ全球団の指導者と最近の人事（server/coachView.mjs leagueStaffView）。古いサーバーには無い */
    val leagueStaff: LeagueStaff? = null,
    /** あなたへのお知らせ（新しい順。トレードの返事・練習試合・予告先発の回避・おるすばん）。古いサーバーには無い */
    val inbox: List<InboxEntry> = emptyList(),
    /** 練習試合（申し込み中と最近の結果。server/exhibition.mjs exhibitionsView）。古いサーバーには無い */
    val exhibitions: List<Exhibition> = emptyList(),
    /** 予告先発を選ぶための先の試合と指名（server/projection.mjs starterPlan）。古いサーバーには無い */
    val starterPlan: StarterPlan? = null,
)

/** あなたへのお知らせの1件。文（text）はサーバーが作る（PC と同じ文） */
@Serializable
data class InboxEntry(val id: String, val at: String? = null, val type: String? = null, val text: String = "")

/** 練習試合（status: offered / played）。mine は自分が申し込んだ側 */
@Serializable
data class Exhibition(
    val id: String,
    val status: String = "offered",
    val mine: Boolean = false,
    val fromTeam: String = "",
    val toTeam: String = "",
    val note: String? = null,
    val createdAt: String? = null,
    val playedAt: String? = null,
    /** 結果（試合の詳細と同じ形の箱。played のときだけ） */
    val result: JsonObject? = null,
)

/** 予告先発（canPick: 自分で選べるか。picks: 試合 id → 指名した投手 id） */
@Serializable
data class StarterPlan(
    val lockTurns: Int = 3,
    val canPick: Boolean = false,
    val games: List<ScheduledGame> = emptyList(),
    val picks: Map<String, Long> = emptyMap(),
)

/** 回ごとの得点（away・home の順。サヨナラの裏は途中まで） */
@Serializable
data class LineScore(val away: List<Int> = emptyList(), val home: List<Int> = emptyList())

/** 得点経過の1件（server/recordedStats.mjs scoringPlaysOf）。half は top / bottom、away・home は得点後の点 */
@Serializable
data class ScoringPlay(
    val inning: Int = 1,
    val half: String = "top",
    val team: String? = null,
    val id: Long? = null,
    val name: String? = null,
    val kind: String? = null,
    val runs: Int = 0,
    val away: Int = 0,
    val home: Int = 0,
)

@Serializable
data class GameDate(val year: Int, val month: Int = 1, val day: Int = 1)

@Serializable
data class TeamLabel(val label: String? = null, val short: String? = null)

@Serializable
data class Member(
    val label: String? = null,
    val teamName: String? = null,
    val displayName: String? = null,
    /** 手続きで待たれていない（決定済み・指導者に任せた・CPUが決める。server/projection.mjs の members） */
    val ready: Boolean = false,
    /** 途中参加でセットを待っていて、手続きはCPUが決める */
    val cpu: Boolean = false,
    /** この手続きを指導者に任せている */
    val delegated: Boolean = false,
    /** オーナーのひとこと（順位表・紙面に出す） */
    val comment: String? = null,
    val commentAt: String? = null,
    /** しばらく来ていない（おるすばん。指導者に任せた扱い） */
    val away: Boolean = false,
    /** 最後に来た日（日本時間の 2026-11-14。時刻は出さない） */
    val lastSeenDay: String? = null,
)

@Serializable
data class Standing(
    val team: String,
    val wins: Int = 0,
    val losses: Int = 0,
    val draws: Int = 0,
    val winRate: Double = 0.0,
    val gamesPlayed: Int = 0,
)

@Serializable
data class PitcherRef(val id: Long? = null, val name: String? = null)

@Serializable
data class Decisions(
    val winningPitcher: PitcherRef? = null,
    val losingPitcher: PitcherRef? = null,
    val savePitcher: PitcherRef? = null,
)

@Serializable
data class GameResult(
    val gameId: Long? = null,
    val date: GameDate? = null,
    val home: String,
    val away: String,
    val homeScore: Int? = null,
    val awayScore: Int? = null,
    val decisions: Decisions? = null,
)

/** 自球団の直近の試合（ビューの `recentGames`） */
@Serializable
data class OwnGame(
    val id: Long? = null,
    val date: GameDate? = null,
    val number: Int? = null,
    val home: String,
    val away: String,
    val homeScore: Int? = null,
    val awayScore: Int? = null,
    val decisions: Decisions? = null,
    /** 本塁打（打った人と何号）。記録の無い試合では null */
    val homeruns: List<OwnHomerun>? = null,
    /** 回ごとの得点（速報再生）。古い試合では null */
    val lineScore: LineScore? = null,
    /** 得点経過。記録の無い試合では null */
    val scoring: List<ScoringPlay>? = null,
)

@Serializable
data class OwnHomerun(val name: String? = null, val team: String? = null, val number: Int? = null)

@Serializable
data class StarterInfo(
    val id: Long? = null,
    val name: String? = null,
    val throws: String? = null,
    val wins: Int = 0,
    val losses: Int = 0,
    val era: Double? = null,
)

@Serializable
data class ScheduledGame(
    val id: Long? = null,
    val date: GameDate? = null,
    val number: Int? = null,
    val home: String,
    val away: String,
    val homeStarterInfo: StarterInfo? = null,
    val awayStarterInfo: StarterInfo? = null,
    /** 予告先発の印（pick: 自分が指名・確定前、fixed: 確定した予告先発） */
    val homeStarterMark: String? = null,
    val awayStarterMark: String? = null,
    /** 先発が確定した（試合の [StarterPlan.lockTurns] ターン前から） */
    val starterLocked: Boolean = false,
)

@Serializable
data class Phase(
    val id: String? = null,
    val kind: String? = null,
    val label: String? = null,
    val deadline: String? = null,
    /** 標準案を出した指導者（「山田監督の案です」）。任せ方が「自分で」なら無い */
    val planBy: PlanBy? = null,
    /** 自分がこの手続きを指導者に任せているか（任せた手続きは提出しても指導者の案で決まる） */
    val delegated: Boolean = false,
)

@Serializable
data class Batting(
    val meet: Int? = null,
    val power: Int? = null,
    val eye: Int? = null,
    val bats: String? = null,
    val steal: Int? = null,
    val bunt: Int? = null,
)

@Serializable
data class Pitching(
    val velocity: Int? = null,
    val control: Int? = null,
    val stamina: Int? = null,
    val form: String? = null,
    /** 回転（変化球のキレ）。初期メンバーの組など、持たない一覧もある */
    val spinRate: Int? = null,
    val arsenal: List<ArsenalPitch> = emptyList(),
)

/** 持ち球（type は PITCH_TYPE_NAMES の鍵。level はキレ） */
@Serializable
data class ArsenalPitch(val type: String? = null, val level: Int? = null)

@Serializable
data class Fielding(val defense: Int? = null)

@Serializable
data class Physical(val speed: Int? = null, val arm: Int? = null, val throws: String? = null)

@Serializable
data class BattingMetrics(
    val pa: Int = 0,
    val avg: Double? = null,
    val obp: Double? = null,
    /** 長打率−打率（OPS = 出塁率 + 打率 + iso） */
    val iso: Double? = null,
    val homeruns: Int = 0,
    val stolenBases: Int = 0,
) {
    val ops: Double? get() = if (obp != null && avg != null && iso != null) obp + avg + iso else null
}

/** 成績の特徴（「アベレージヒッター」など。server/performanceLabels.mjs）。tone は good / bad */
@Serializable
data class PerformanceLabel(val id: String? = null, val text: String = "", val tone: String? = null)

@Serializable
data class PitchingMetrics(val outs: Int = 0, val era: Double? = null, val k9: Double? = null)

@Serializable
data class BattingPerformance(val metrics: BattingMetrics? = null, val labels: List<PerformanceLabel> = emptyList())

@Serializable
data class PitchingPerformance(val metrics: PitchingMetrics? = null)

@Serializable
data class Performance(
    val batting: BattingPerformance? = null,
    val pitching: PitchingPerformance? = null,
)

@Serializable
data class Player(
    val id: Long,
    val name: String,
    val age: Int? = null,
    val position: String,
    val isActive: Boolean = true,
    val condition: Int? = null,
    val fatigue: Int? = null,
    val batting: Batting? = null,
    val pitching: Pitching? = null,
    val fielding: Fielding? = null,
    val physical: Physical? = null,
    val positionFitness: Map<String, Int> = emptyMap(),
    val performance: Performance? = null,
    /** 伸びしろ（自球団の選手だけ。他球団の名簿には無い） */
    val growthPotential: Double? = null,
    val origin: Origin? = null,
    /** 経歴（古い順。入団・移籍・退団。サーバーは新しい8件まで） */
    val careerHistory: List<CareerEntry> = emptyList(),
    val seasonStats: SeasonStats? = null,
    /** 打者の最近の調子（server/recordedViews.mjs recentForm）。打数が無い・古いサーバーでは null */
    val recent: RecentForm? = null,
    /** CPU球団がトレードで付ける値段（見る目をかける前。球団の読み込みにだけ載る。server/tradeJudge.mjs の valueOf） */
    val tradeValue: Double? = null,
    /** 事情（抜けたときの穴）を抜いた値段。CPU球団の選手だけ。まとめてもらうときの見込みに使う（[setTradeValues]） */
    val tradeBase: Double? = null,
) {
    /** 守備位置の適性。本職は100（Web 版 lineupEdit.js の positionFitness と同じ決まり） */
    fun fitness(pos: String): Int = if (position == pos) 100 else positionFitness[pos] ?: 0
    val isPitcher: Boolean get() = position == "pitcher"
}

@Serializable
data class AuthSession(
    val userId: String,
    val accessToken: String,
    val sessionId: String,
    val refreshToken: String? = null,
    /** アクセストークンの期限（エポックミリ秒）。ローカルの開発サーバーでは無い */
    val expiresAt: Long? = null,
)

@Serializable
data class RefreshResult(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresAt: Long? = null,
    val userId: String? = null,
)

/** 連勝・連敗（kind は W / L / D） */
@Serializable
data class TeamStreak(val kind: String = "", val count: Int = 0)

@Serializable
data class Origin(val highSchool: String? = null, val university: String? = null, val previousTeam: String? = null)

/** 経歴の1件（type: highschool / university / independent など。label は学校や球団の名前） */
@Serializable
data class CareerEntry(val type: String? = null, val year: Int? = null, val label: String? = null)

/** 今季の通しの数（紙面の「8号」「5勝2敗」に使う分だけ） */
@Serializable
data class SeasonStats(val batting: SeasonBatting? = null, val pitching: SeasonPitching? = null)

@Serializable
data class SeasonBatting(val games: Int = 0, val atBats: Int = 0, val hits: Int = 0, val homeruns: Int = 0, val rbis: Int = 0)

@Serializable
data class SeasonPitching(val games: Int = 0, val wins: Int = 0, val losses: Int = 0, val saves: Int = 0, val holds: Int = 0)

/** 直近の試合の打撃（[games] 試合で [atBats] 打数 [hits] 安打）と連続試合安打 */
@Serializable
data class RecentForm(val games: Int = 0, val atBats: Int = 0, val hits: Int = 0, val hitStreak: Int = 0)
