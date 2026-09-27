import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const appUrl = process.env.POKER_APP_URL ?? 'http://localhost:3000'

export const DESKTOP = { width: 1440, height: 900 } as const
export const MOBILE = { width: 390, height: 844 } as const

export type ViewportName = 'desktop' | 'mobile'
export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: DESKTOP,
  mobile: MOBILE,
}

export const ROOM_URL_RE = /\/room\/[A-HJ-NP-Z2-9]{6}$/

export interface Player {
  name: string
  viewport: ViewportName
  context: BrowserContext
  page: Page
  tap: RoomTap
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any

/**
 * Records what the PartyKit room actually sends this client. The DOM tells us
 * what the player sees; the tap tells us what they were *allowed* to know
 * (privacy) and surfaces server-side action failures that the room UI swallows.
 */
export class RoomTap {
  snapshot: Json = null
  social: Json = null
  session: Json = null
  failures: string[] = []
  results: string[] = []
  pageErrors: string[] = []
  snapshots = 0
  /** Every player id any snapshot has shown peeking (brief peeks are easy to miss by polling). */
  everPeeking = new Set<string>()

  /** Forget everything received so far (e.g. before a reload) so waits only see fresh data. */
  reset() {
    this.snapshot = null
    this.social = null
    this.session = null
    this.failures = []
    this.results = []
  }

  attach(page: Page) {
    page.on('websocket', ws => {
      if (!ws.url().includes('/parties/')) {
        return
      }
      ws.on('framereceived', frame => {
        const raw = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
        let message: Json
        try {
          message = JSON.parse(raw)
        } catch {
          return
        }
        switch (message?.type) {
          case 'room_snapshot':
            this.snapshot = message.state
            this.snapshots += 1
            for (const player of message.state?.players ?? []) {
              if (player?.isPeeking) this.everPeeking.add(player.id)
            }
            break
          case 'social_snapshot':
            this.social = message.social
            break
          case 'private_session':
            this.session = message
            break
          case 'action_failed':
          case 'error':
            this.failures.push(String(message.message))
            break
          case 'action_result':
            if (message.message) this.results.push(String(message.message))
            break
        }
      })
    })
  }

  get yourId(): string {
    return this.session?.yourId ?? ''
  }

  me(): Json {
    return this.snapshot?.players?.find((player: Json) => player.id === this.yourId)
  }

  player(id: string): Json {
    return this.snapshot?.players?.find((player: Json) => player.id === id)
  }

  playerByName(name: string): Json {
    return this.snapshot?.players?.find((player: Json) => player.nickname === name)
      ?? this.snapshot?.lobbyPlayers?.find((player: Json) => player.nickname === name)
  }
}

const QA_DIR = path.join(process.cwd(), 'output', 'qa')

/** Only the element the user can actually see (both 2D and 3D trees can render a control). */
export function visible(locator: Locator): Locator {
  return locator.filter({ visible: true })
}

export async function newPlayer(
  browser: Browser,
  name: string,
  viewportName: ViewportName
): Promise<Player> {
  const viewport = VIEWPORTS[viewportName]
  const context = await browser.newContext({
    viewport,
    hasTouch: viewportName === 'mobile',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  // Never let a native confirm() (Leave game) block the run.
  page.on('dialog', dialog => { void dialog.accept() })
  // The Next.js dev-tools badge (bottom-left) sits on top of the mobile Fold
  // button and target panel. It does not exist in production builds, so hide it;
  // real runtime errors are still collected through the tap below.
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal { display: none !important; }'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })
  const tap = new RoomTap()
  tap.attach(page)
  page.on('pageerror', error => tap.pageErrors.push(String(error?.message ?? error)))
  return { name, viewport: viewportName, context, page, tap }
}

export async function closeAll(players: Player[]) {
  await Promise.allSettled(players.map(player => player.context.close()))
}

export async function snap(page: Page, name: string): Promise<string> {
  fs.mkdirSync(QA_DIR, { recursive: true })
  const file = path.join(QA_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined)
  const metrics = await page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement
    return {
      url: location.href,
      viewport: `${innerWidth}x${innerHeight}`,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      scrollLeft: scroller.scrollLeft,
      scrollWidth: scroller.scrollWidth,
      phase: document.querySelector('.table-scene')?.getAttribute('data-phase'),
      layout: document.querySelector('.table-scene')?.getAttribute('data-layout'),
    }
  }).catch(() => null)
  if (metrics) {
    fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(metrics, null, 2))
  }
  return file
}

export function tableScene(page: Page): Locator {
  return page.locator('.table-scene')
}

/**
 * Next dev hydrates the entry forms late; typing before hydration is wiped when
 * React takes over the controlled input. Re-type until the value sticks.
 */
export async function fillHydrated(input: Locator, value: string) {
  await expect(async () => {
    await input.fill(value)
    await input.page().waitForTimeout(250)
    await expect(input).toHaveValue(value, { timeout: 500 })
  }).toPass({ timeout: 60_000 })
}

async function submitNickname(page: Page, name: string, button: string, urlPattern: RegExp | null) {
  const nickname = page.getByLabel('Your nickname')
  await expect(async () => {
    await fillHydrated(nickname, name)
    await page.getByRole('button', { name: button }).click()
    if (urlPattern) {
      await expect(page).toHaveURL(urlPattern, { timeout: 8_000 })
    } else {
      await expect(nickname).toBeHidden({ timeout: 8_000 })
    }
  }).toPass({ timeout: 90_000 })
}

export async function createTable(player: Player): Promise<{ roomCode: string; roomUrl: string }> {
  const { page, name } = player
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Poker Night' })).toBeVisible({ timeout: 60_000 })
  // Nickname-only sign-in: the Email / Venmo fields were removed.
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await expect(page.getByLabel('Venmo username')).toHaveCount(0)
  await submitNickname(page, name, 'Create Table', ROOM_URL_RE)
  const roomUrl = page.url()
  const roomCode = roomUrl.split('/').pop() ?? ''
  await expect(tableScene(page)).toBeVisible({ timeout: 60_000 })
  await expectSeated(player)
  return { roomCode, roomUrl }
}

export async function joinTable(player: Player, roomUrl: string) {
  const { page, name } = player
  await page.goto(roomUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Take your seat' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await submitNickname(page, name, 'Enter Room', null)
  await expect(tableScene(page)).toBeVisible({ timeout: 60_000 })
  await expectSeated(player)
}

/** Join from the landing page Join tab with a typed room code. */
export async function joinByCode(player: Player, roomCode: string) {
  const { page, name } = player
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await expect(async () => {
    await page.getByRole('tab', { name: 'Join' }).click()
    await expect(page.getByLabel('Room code')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 60_000 })
  await fillHydrated(page.getByLabel('Room code'), roomCode)
  await submitNickname(page, name, 'Join Table', new RegExp(`/room/${roomCode}$`))
  await expect(tableScene(page)).toBeVisible({ timeout: 60_000 })
  await expectSeated(player)
}

/** The server snapshot is the canonical, layout-independent seat list. */
export async function expectSeated(player: Player) {
  await expect.poll(() => Boolean(player.tap.me()), {
    timeout: 60_000,
    message: `${player.name} should be seated`,
  }).toBe(true)
}

export async function openSettings(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Table menu' })
  if (await dialog.isVisible()) {
    return dialog
  }
  await visible(page.getByRole('button', { name: 'Open settings' })).first().click()
  await expect(dialog).toBeVisible()
  return dialog
}

export async function closeSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Table menu' })
  if (!(await dialog.isVisible())) {
    return
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
}

export async function openSettingsTab(page: Page, tab: 'Settings' | 'Outfit' | 'Players'): Promise<Locator> {
  const dialog = await openSettings(page)
  await dialog.getByRole('button', { name: tab === 'Players' ? /^Players \(\d+\)$/ : tab, exact: tab !== 'Players' }).click()
  return dialog
}

export interface TableSettingsInput {
  smallBlind?: number
  bigBlind?: number
  startingStack?: number
  actionTimerSeconds?: number
  nextHandDelaySeconds?: number
  bountyPercent?: number
  rabbitHunting?: boolean
  sevenTwo?: boolean
}

export async function saveTableSettings(page: Page, input: TableSettingsInput) {
  const dialog = await openSettingsTab(page, 'Settings')
  if (input.smallBlind !== undefined) await dialog.getByLabel('Small blind').fill(String(input.smallBlind))
  if (input.bigBlind !== undefined) await dialog.getByLabel('Big blind').fill(String(input.bigBlind))
  if (input.startingStack !== undefined) await dialog.getByLabel('Starting stack').fill(String(input.startingStack))
  if (input.actionTimerSeconds !== undefined) {
    await dialog.getByLabel('Action timer (seconds)').fill(String(input.actionTimerSeconds))
  }
  if (input.nextHandDelaySeconds !== undefined) {
    await dialog.getByLabel('Next hand delay (seconds)').fill(String(input.nextHandDelaySeconds))
  }
  if (input.rabbitHunting !== undefined) {
    await ruleRow(dialog, 'Rabbit hunting').getByRole('button', { name: input.rabbitHunting ? 'On' : 'Off', exact: true }).click()
  }
  if (input.sevenTwo !== undefined) {
    await ruleRow(dialog, '7 / 2 rule').getByRole('button', { name: input.sevenTwo ? 'On' : 'Off', exact: true }).click()
  }
  if (input.bountyPercent !== undefined) {
    const customize = ruleRow(dialog, '7 / 2 rule').getByRole('button', { name: 'Customize' })
    if ((await customize.getAttribute('aria-pressed')) !== 'true') {
      await customize.click()
    }
    await dialog.getByLabel('Bounty % of original buy-in').fill(String(input.bountyPercent))
  }
  const save = dialog.getByRole('button', { name: /Save table settings|Save for next hand/ })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(dialog.getByRole('button', { name: /Save table settings|Save for next hand/ })).toBeDisabled({ timeout: 15_000 })
}

export function ruleRow(dialog: Locator, name: string): Locator {
  return dialog.locator('.settings-rule-row').filter({ hasText: name })
}

export function actionButton(page: Page, action: 'fold' | 'check' | 'call' | 'raise' | 'all_in'): Locator {
  return visible(page.locator(`[data-action="${action}"]`)).first()
}

export async function isMyTurn(page: Page): Promise<boolean> {
  return (await visible(page.locator('[data-action="fold"]')).count()) > 0
}

/** Resolve which player currently holds the action (the one whose Fold button is on screen). */
export async function waitForTurn(players: Player[], timeout = 45_000): Promise<Player> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const player of players) {
      if (await isMyTurn(player.page)) {
        return player
      }
    }
    await players[0]!.page.waitForTimeout(200)
  }
  throw new Error(`No player got the action within ${timeout}ms (${players.map(p => p.name).join(', ')})`)
}

export async function clickStartGame(page: Page) {
  const start = visible(page.getByRole('button', { name: /^(Start game|Deal next hand)$/ })).first()
  await expect(start).toBeEnabled({ timeout: 30_000 })
  await start.click()
}

export async function waitForPhase(page: Page, phase: 'waiting' | 'in_hand' | 'between_hands', timeout = 45_000) {
  await expect(tableScene(page)).toHaveAttribute('data-phase', phase, { timeout })
}

export async function waitForHandNumberChange(page: Page, fromPhase: string, timeout = 45_000) {
  await expect(tableScene(page)).not.toHaveAttribute('data-phase', fromPhase, { timeout })
}

export async function addBots(page: Page, which: 'Add bot' | 'Fill seats') {
  const button = visible(page.getByRole('button', { name: which, exact: true })).first()
  await expect(button).toBeEnabled({ timeout: 30_000 })
  await button.click()
}

export async function playerCount(page: Page): Promise<number> {
  return Number(await tableScene(page).getAttribute('data-player-count'))
}

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText)
}

export async function waitForSnapshot(
  player: Player,
  predicate: (state: Json, tap: RoomTap) => boolean,
  message: string,
  timeout = 45_000
) {
  await expect.poll(() => {
    try {
      return Boolean(player.tap.snapshot && predicate(player.tap.snapshot, player.tap))
    } catch {
      return false
    }
  }, { timeout, message: `${player.name}: ${message}` }).toBe(true)
}

/** Face-up hole cards the viewer can see at an opponent's seat (3D overlay or 2D edge seat). */
export function seatRevealedCards(viewer: Player, target: { id: string; name: string }): Locator {
  if (viewer.viewport === 'desktop') {
    return visible(viewer.page.locator(`[data-seat-player="${target.id}"] .cinematic-hole-cards .is-face`))
  }
  const seatName = target.name.replace(/^Bot\s+/i, '')
  return visible(
    viewer.page.locator('.mobile-edge-seat')
      .filter({ has: viewer.page.locator('.mobile-edge-seat-name', { hasText: seatName }) })
      .locator('.card:not(.face-down)')
  )
}

/** Opens the targeted reaction / message panel for an opponent seat. */
export async function openTargetPanel(viewer: Player, targetName: string): Promise<Locator> {
  const trigger = viewer.viewport === 'desktop'
    ? viewer.page.getByRole('button', { name: `Send a reaction to ${targetName}` })
    : viewer.page.getByRole('button', { name: `Target ${targetName} for emojis` })
  await clickOrReport(
    visible(trigger).first(),
    `Seat target for "${targetName}" is covered and cannot be clicked`,
    `ui-issue-seat-target-${viewer.viewport}-${targetName}`
  )
  const panel = viewer.page.getByRole('dialog', { name: `Message or react to ${targetName}` })
  await expect(panel).toBeVisible()
  return panel
}

/** Record every value a data-* attribute takes on (animation stages change faster than polling). */
export async function recordAttribute(page: Page, selector: string, attribute: string, key: string) {
  await page.evaluate(({ selector, attribute, key }) => {
    const store = ((window as unknown as { __qaAttr?: Record<string, string[]> }).__qaAttr ??= {})
    const values: string[] = (store[key] = [])
    const push = () => {
      const element = document.querySelector(selector)
      const value = element?.getAttribute(attribute) ?? '(none)'
      if (values[values.length - 1] !== value) values.push(value)
    }
    push()
    new MutationObserver(push).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [attribute],
    })
  }, { selector, attribute, key })
}

export async function recordedAttribute(page: Page, key: string): Promise<string[]> {
  return page.evaluate(k => (window as unknown as { __qaAttr?: Record<string, string[]> }).__qaAttr?.[k] ?? [], key)
}

export function otherViewport(viewport: ViewportName): ViewportName {
  return viewport === 'desktop' ? 'mobile' : 'desktop'
}

/**
 * Clicks a control the way a user would. If another element covers it (layout
 * regression), record a UI issue with a screenshot and fall back to the
 * keyboard so the rest of the feature can still be verified.
 */
export async function clickOrReport(
  locator: Locator,
  issue: string,
  screenshotName: string
): Promise<'clicked' | 'keyboard'> {
  await expect(locator).toBeVisible()
  try {
    await locator.click({ trial: true, timeout: 5_000 })
    await locator.click()
    return 'clicked'
  } catch {
    const page = locator.page()
    const file = await snap(page, screenshotName)
    const blocker = await locator.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ').join('.')}` + ` in ${top.closest('[class]')?.parentElement?.className ?? ''}` : 'unknown'
    }).catch(() => 'unknown')
    test.info().annotations.push({
      type: 'ui-issue',
      description: `${issue} — covered by ${blocker} (viewport ${page.viewportSize()?.width}x${page.viewportSize()?.height}); screenshot ${file}`,
    })
    await locator.focus()
    await locator.press('Enter')
    return 'keyboard'
  }
}

/**
 * Host creates a room on `viewports[0]`; everyone else joins by link in order
 * (so seats are 0, 1, 2, ...). Applies table settings before anyone plays.
 */
export async function startTable(
  browser: Browser,
  prefix: string,
  viewports: ViewportName[],
  settings: TableSettingsInput
): Promise<Player[]> {
  const players: Player[] = []
  for (const [index, viewport] of viewports.entries()) {
    players.push(await newPlayer(browser, `${prefix}${index === 0 ? 'Host' : `P${index}`}${viewport === 'desktop' ? 'D' : 'M'}`, viewport))
  }
  const [host, ...guests] = players
  const { roomUrl } = await createTable(host!)
  for (const guest of guests) {
    await joinTable(guest, roomUrl)
  }
  await expect(tableScene(host!.page)).toHaveAttribute('data-player-count', String(players.length))
  await saveTableSettings(host!.page, settings)
  await closeSettings(host!.page)
  return players
}

/** Go all-in with the viewport's own controls. */
/** Mobile tray: sizing (slider, presets) opens only after tapping Raise / Bet. */
export async function openMobileRaise(page: Page) {
  const opener = visible(page.locator('[data-action="open-raise"]'))
  if (await opener.count()) {
    await opener.first().click()
  }
}

export async function goAllIn(player: Player) {
  const page = player.page
  if (player.viewport === 'mobile') {
    await openMobileRaise(page)
    const quickAllIn = visible(page.getByRole('group', { name: 'Quick bet sizes' }).getByRole('button', { name: 'All-in' }))
    if (await quickAllIn.count()) {
      await quickAllIn.first().click()
    }
  }
  await actionButton(page, 'all_in').click()
}

/** Check when free, otherwise call. */
export async function checkOrCall(player: Player) {
  const check = actionButton(player.page, 'check')
  if (await check.count()) {
    await check.click()
    return 'check'
  }
  await actionButton(player.page, 'call').click()
  return 'call'
}

export function isSubsequence(values: string[], expected: string[]): boolean {
  let cursor = 0
  for (const value of values) {
    if (value === expected[cursor]) cursor += 1
    if (cursor === expected.length) return true
  }
  return cursor === expected.length
}
