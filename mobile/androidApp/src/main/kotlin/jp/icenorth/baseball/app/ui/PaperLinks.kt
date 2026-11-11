package jp.icenorth.baseball.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import jp.icenorth.baseball.shared.NameRef
import jp.icenorth.baseball.shared.nameSpans

/** 紙面の文の中の選手名を押して、その選手の詳細を開くための表と開き方（ホームが渡す） */
class PaperLinks(val index: Map<String, NameRef>, val open: (NameRef, String) -> Unit)

val LocalPaperLinks = compositionLocalOf<PaperLinks?> { null }

/**
 * 紙面の文。手元で分かる選手の名前に下線を引き、押すと選手の詳細を開く。
 * ⚠ 文の色や書体はそのまま（下線だけ足す。3つの紙面の見た目を崩さない）
 */
@Composable
fun paperText(text: String): AnnotatedString {
    val links = LocalPaperLinks.current ?: return AnnotatedString(text)
    val spans = remember(text, links.index) { nameSpans(text, links.index) }
    if (spans.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        var at = 0
        spans.forEach { (start, end, name) ->
            append(text.substring(at, start))
            val ref = links.index.getValue(name)
            withLink(LinkAnnotation.Clickable("player:$name", TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))) { links.open(ref, name) }) {
                append(name)
            }
            at = end
        }
        append(text.substring(at))
    }
}
