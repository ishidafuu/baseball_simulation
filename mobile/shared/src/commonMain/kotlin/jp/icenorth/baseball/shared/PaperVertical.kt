package jp.icenorth.baseball.shared

/*
 * 新聞風の紙面の縦書きの割り付け（マスに分ける・列に分ける）。描くのは Android の PaperParts.kt（VerticalText）。
 * 描き方に依らないので、ここに置いて検査する。
 */

/** 縦書きの1マス（kind: 0 ふつう・1 回す・2 句読点・3 小書き・4 縦中横） */
data class VCell(val text: String, val kind: Int)

private const val ROTATE = "ー－―‐…‥～〜（）「」『』【】〔〕［］〈〉《》＜＞-—~()[]=＝→←"
private const val PUNCT = "、。，．"
private const val SMALL = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"
/** 列の頭に来てはいけない字 */
private const val NO_START = "、。，．」』）】〕］〉》ーっゃゅょッャュョ！？!?"

private fun Char.isTcy() = this in '0'..'9' || this in 'A'..'Z' || this in 'a'..'z' || this == '.' || this == '%' || this == '+'

private fun VCell.noStart() = text.length == 1 && text[0] in NO_START
private fun VCell.hangs() = text.length == 1 && text[0] in PUNCT

/** 縦書きのマスに分ける */
fun verticalCells(text: String): List<VCell> {
    val out = mutableListOf<VCell>()
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c.isTcy()) {
            var j = i
            while (j < text.length && text[j].isTcy()) j++
            val run = text.substring(i, j)
            // 3字までは1マスに。長いものは2字ずつ
            if (run.length <= 3) out += VCell(run, 4) else run.chunked(2).forEach { out += VCell(it, 4) }
            i = j
            continue
        }
        // 半角の空白（「秋山 正」の姓と名の間）は縦書きでは詰める。全角の空白（字下げ）は1マス
        if (c == ' ') { i++; continue }
        out += when {
            c == '　' -> VCell("　", 0)
            c in ROTATE -> VCell(c.toString(), 1)
            c in PUNCT -> VCell(c.toString(), 2)
            c in SMALL -> VCell(c.toString(), 3)
            else -> VCell(c.toString(), 0)
        }
        i++
    }
    return out
}

/**
 * マスを列に分ける（[per] マスずつ）。列の頭に来てはいけない字（[NO_START]）は:
 * - 「、。」だけは前の列の終わりにぶら下げる（その列は [per]＋1 マス。描く側は [per]＋1 マスの高さを取る）
 * - そのほか（「」ー っ ）」など）と、ぶら下げた後にまた続くときは、前の列の終わりの字を次の列へ送る（追い出し）
 *   ⚠ 以前は「」ー っ ）」も [per]＋1 マス目にぶら下げており、[per] マスの高さしか取らない所で下の段と重なった
 */
fun verticalColumns(cells: List<VCell>, per: Int): List<List<VCell>> {
    val cols = mutableListOf<MutableList<VCell>>()
    var cur = mutableListOf<VCell>()
    for (c in cells) {
        if (cur.size >= per) {
            if (c.hangs() && cur.size == per) { cur += c; continue }
            var next = mutableListOf<VCell>()
            if (c.noStart()) {
                // 列の終わりから、頭に来てよい字まで戻って、そこから後を次の列へ送る
                // （列は1字は残す。送った字で次の列が [per] マスを超えるほど続くときは、送らずに頭に置く）
                var k = cur.size - 1
                while (k > 0 && cur[k].noStart()) k--
                if (k > 0 && cur.size - k < per) {
                    next = cur.subList(k, cur.size).toMutableList()
                    cur = cur.subList(0, k).toMutableList()
                }
            }
            cols += cur
            cur = next
        }
        cur += c
    }
    if (cur.isNotEmpty()) cols += cur
    return cols
}
