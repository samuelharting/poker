/**
 * A small yellow sticky-note chip on a player's nameplate/seat: the 2D twin of
 * the paper note on their 3D forehead (also the only place the hero's own
 * note shows, since the hero has no 3D avatar).
 */
export function StickyNoteChip({ note }: { note?: { text: string; fromNickname: string } }) {
  if (!note) return null
  return (
    <span
      className="sticky-note-chip"
      title={`${note.fromNickname} stuck this on them`}
      aria-label={`Sticky note: ${note.text}, stuck on by ${note.fromNickname}`}
    >
      {note.text}
    </span>
  )
}
