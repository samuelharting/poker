import type PokerRoom from '@/partykit/room'

/** Drinking is off by default at a new table; fun-mode tests start with it on. */
export function enableDrinking(server: PokerRoom): PokerRoom {
  ;(server as unknown as { data: { tableSettings: { funModeEnabled: boolean } } }).data.tableSettings.funModeEnabled = true
  return server
}
