async (page) => {
  await page.waitForTimeout(250)
  await page.screenshot({
    path: `output/playwright/layout-state-${await page.evaluate(() => innerWidth)}x${await page.evaluate(() => innerHeight)}.png`,
    animations: 'disabled',
  })

  return page.evaluate(() => {
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height].map(value => Number(value.toFixed(1)))
    }

    const visible = element => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    }

    return {
      viewport: [innerWidth, innerHeight],
      phase: document.querySelector('.table-scene')?.getAttribute('data-phase'),
      trayOpen: document.querySelector('.table-scene')?.getAttribute('data-tray-open'),
      tray: box(document.querySelector('.betting-tray')),
      pot: box(document.querySelector('.pot-display-card')),
      settings: box(document.querySelector('.settings-modal')),
      reveal: box(document.querySelector('.show-cards-toggle')),
      revealButtons: Array.from(document.querySelectorAll('.show-cards-toggle-button')).map(button => ({
        text: button.textContent?.trim(),
        box: box(button),
      })),
      seats: Array.from(document.querySelectorAll('.cinematic-seat')).map(seat => ({
        classes: seat.className,
        text: seat.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100),
        box: box(seat),
        bet: box(seat.querySelector('.cinematic-seat-bet')),
        betVisible: visible(seat.querySelector('.cinematic-seat-bet')),
      })),
      winner: Array.from(document.querySelectorAll('.table-center-winner-announcement')).map(item => ({
        seat: item.getAttribute('data-winner-seat'),
        text: item.textContent?.trim().replace(/\s+/g, ' '),
        box: box(item),
      })),
      overflow: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
    }
  })
}
