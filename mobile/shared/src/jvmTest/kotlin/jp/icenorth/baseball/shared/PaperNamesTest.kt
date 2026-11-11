package jp.icenorth.baseball.shared

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

class PaperNamesTest {
    private fun json(text: String): JsonObject = OnlineJson.parseToJsonElement(text).jsonObject

    @Test
    fun namesAreLinkedOnlyWhenUnambiguous() {
        val raw = json(
            """{"roster":[{"id":1,"name":"山田 太郎"},{"id":2,"name":"佐藤 一"}],
               "leaders":[{"rows":[{"id":9,"name":"鈴木 次郎","team":"B"},{"id":1,"name":"山田 太郎","team":"A"},{"id":7,"name":"佐藤 一","team":"C"}]}]}""",
        )
        val index = paperNameIndex(raw, "A", null, null)
        assertEquals(NameRef("A", 1), index["山田 太郎"])
        assertEquals(NameRef("B", 9), index["鈴木 次郎"])
        // 別の球団に同じ名前がいる → 押せない
        assertEquals(null, index["佐藤 一"])
        val spans = nameSpans("山田 太郎が3安打。鈴木 次郎は無安打", index)
        assertEquals(listOf(Triple(0, 5, "山田 太郎"), Triple(10, 15, "鈴木 次郎")), spans)
    }
}
