'use client'

import dynamic from 'next/dynamic'
import clsx from 'clsx'
import type { EmojiClickData } from 'emoji-picker-react'
import { EmojiStyle, Theme } from 'emoji-picker-react'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
})

interface SearchableEmojiPickerProps {
  isConnected: boolean
  onSelect: (emoji: string) => void
  className?: string
  searchPlaceholder?: string
}

export function SearchableEmojiPicker({
  isConnected,
  onSelect,
  className,
  searchPlaceholder = 'Search all emojis',
}: SearchableEmojiPickerProps) {
  return (
    <div className={clsx('emoji-picker-shell', className)}>
      <EmojiPicker
        open
        lazyLoadEmojis
        autoFocusSearch
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        width="100%"
        height={360}
        searchPlaceholder={searchPlaceholder}
        previewConfig={{ showPreview: false }}
        onEmojiClick={(emojiData: EmojiClickData) => {
          if (!isConnected) {
            return
          }

          onSelect(emojiData.emoji)
        }}
      />
    </div>
  )
}
