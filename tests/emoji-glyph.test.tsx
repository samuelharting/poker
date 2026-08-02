import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmojiGlyph, ISRAEL_FLAG_EMOJI } from '@/components/ui/EmojiGlyph'

describe('EmojiGlyph', () => {
  it('renders the Israel reaction as a flag graphic instead of regional letters', () => {
    const markup = renderToStaticMarkup(<EmojiGlyph emoji={ISRAEL_FLAG_EMOJI} />)

    expect(markup).toContain('emoji-glyph-israel')
    expect(markup).toContain('<svg')
    expect(markup).toContain('#1746a2')
    expect(markup).not.toContain('IL')
  })

  it('keeps ordinary emoji glyphs unchanged', () => {
    const markup = renderToStaticMarkup(<EmojiGlyph emoji="\uD83D\uDC12" />)
    expect(markup).toContain('emoji-glyph')
    expect(markup).not.toContain('<svg')
  })
})
