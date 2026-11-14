package jp.icenorth.baseball.shared

import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 手続き・トレード・手続きの結果の通知 */
class EventNoticeTest {
    private val hour = 60 * 60 * 1000L
    private val deadline = 1_000_000_000_000L

    private fun events(json: String, now: Long = deadline - 10 * hour): List<EventNotice> {
        val text = """{"teamName":"津田沼","year":2027,"teamLabels":{"美瑛":{"short":"美瑛"}},$json}"""
        return eventNotices(
            OnlineJson.decodeFromString<LeagueView>(text),
            OnlineJson.parseToJsonElement(text).jsonObject,
            now,
            millisOf = { if (it == "D") deadline else null },
            format = { if (it == "D") "11/16(月) 21:00" else null },
        )
    }

    @Test
    fun procedureStartsAndDeadlineComes() {
        val tryout = """"phase":{"id":"p9","kind":"tryout","deadline":"D"}"""
        val start = events(tryout)
        assertEquals(listOf("proc:tryout:p9"), start.map { it.key })
        assertEquals("トライアウトが始まりました", start.single().title)
        assertTrue(start.single().body.startsWith("締め切り 11/16(月) 21:00"))

        val soon = events(tryout, now = deadline - 2 * hour)
        assertEquals("トライアウトの締め切りが近づいています", soon.last().title)
        assertTrue(soon.last().body.startsWith("あと約2時間"))
        // 開始はもう知らせたので、締め切り間近だけが出る
        assertEquals(soon.last(), eventNotice(soon, start.map { it.key }.toSet()))

        assertTrue(events(""""phase":{"id":"p9","kind":"tryout","deadline":"D","submission":{"ready":true}}""", now = deadline - hour).isEmpty(), "決めたら出さない")
        assertTrue(events(""""phase":{"id":"p9","kind":"tryout","deadline":"D","delegated":true}""").isEmpty(), "指導者に任せたら出さない")
    }

    @Test
    fun campShowsTheRound() {
        val camp = events(""""phase":{"id":"c1","kind":"camp","deadline":"D","camp":{"rounds":1,"total":4}}""").single()
        assertEquals("キャンプが始まりました", camp.title)
        assertTrue(camp.body.contains("第2クール / 全4クール"))
    }

    @Test
    fun tradeOffersAndCounters() {
        val offer = events(""""trades":[{"id":"t1","mine":false,"fromTeam":"美瑛","toTeam":"津田沼","myTurn":true,
            "offer":[{"name":"高橋"}],"want":[{"name":"田中"},{"name":"鈴木"}]}]""").single()
        assertEquals("trade:t1:o", offer.key)
        assertEquals("美瑛からトレードの提案が届きました", offer.title)
        assertEquals("もらう: 高橋\n出す: 田中・鈴木", offer.body)
        val counter = events(""""trades":[{"id":"t2","mine":true,"fromTeam":"津田沼","toTeam":"美瑛","myTurn":true,"countered":true,
            "offer":[{"name":"田中"}],"want":[{"name":"高橋"}]}]""").single()
        assertEquals("美瑛から逆提案が返ってきました", counter.title)
        assertEquals("もらう: 高橋\n出す: 田中", counter.body)
        assertTrue(events(""""trades":[{"id":"t3","mine":true,"myTurn":false}]""").isEmpty(), "相手の番の提案は出さない")
    }

    @Test
    fun tradeNotesAreQuoted() {
        val offer = events(""""trades":[{"id":"t1","mine":false,"fromTeam":"美瑛","toTeam":"津田沼","myTurn":true,"note":"捕手が欲しいです",
            "offer":[{"name":"高橋"}],"want":[{"name":"田中"}]}]""").single()
        assertEquals("もらう: 高橋\n出す: 田中\n「捕手が欲しいです」", offer.body)
        // 逆提案が返ってきたら、相手が逆提案に添えた方を出す
        val counter = events(""""trades":[{"id":"t2","mine":true,"fromTeam":"津田沼","toTeam":"美瑛","myTurn":true,"countered":true,
            "note":"自分の文","replyNote":"この形なら","offer":[{"name":"田中"}],"want":[{"name":"高橋"}]}]""").single()
        assertEquals("もらう: 高橋\n出す: 田中\n「この形なら」", counter.body)
    }

    @Test
    fun inboxNotices() {
        val list = events(""""inbox":[
            {"id":"n5","type":"challenge","text":"美瑛から練習試合の申し込みが届きました"},
            {"id":"n4","type":"tradeCountered","text":"逆提案"},
            {"id":"n3","type":"awayEnded","text":"おかえりなさい"},
            {"id":"n2","type":"starterAvoided","text":"田中は疲れていたため、予告先発を回避しました"},
            {"id":"n1","type":"tradeAccepted","text":"美瑛とのトレードが成立しました"}]""")
        assertEquals(listOf("inbox:n5", "inbox:n2", "inbox:n1"), list.map { it.key }, "逆提案と「来た」は出さない")
        assertEquals("練習試合の申し込みが届きました", list[0].title)
        assertEquals("美瑛から練習試合の申し込みが届きました", list[0].body)
        assertEquals("トレードが成立しました", list[2].title)
        // 見たお知らせは二度知らせない
        assertNull(eventNotice(list, list.map { it.key }.toSet()))
        assertEquals("inbox:n6", eventNotice(events(""""inbox":[{"id":"n6","type":"challengePlayed","text":"練習試合 美瑛 3-2"}]"""), list.map { it.key }.toSet())!!.key)
    }

    @Test
    fun procedureResults() {
        val r = events(""""lastTryout":{"year":2027,"picks":[{"name":"A"},{"name":"B"}],"lost":[{"name":"C"}]}""").single()
        assertEquals("result:tryout:2027", r.key)
        assertEquals("トライアウトの結果: 2人が入団", r.title)
        assertEquals("A・B\n交渉した1人は他球団へ", r.body)
    }

    @Test
    fun firstRunAndCombining() {
        val all = events(""""phase":{"id":"p9","kind":"contract","deadline":"D"},"lastCamp":{"year":2027}""")
        assertNull(eventNotice(all, null), "印がまだ無いときは知らせない")
        assertNull(eventNotice(all, withEventKeys(null, all)))
        val two = eventNotice(all, emptySet())!!
        assertEquals("お知らせ 2件", two.title)
        assertEquals("契約更改が始まりました\nキャンプが終わりました", two.body)
    }
}
