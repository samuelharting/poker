async page => {
  return await page.evaluate(() => {
    const pathFor = (element) => {
      if (!element) return null;
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        if (current.id) part += `#${current.id}`;
        const classes = typeof current.className === "string"
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
          : [];
        if (classes.length) part += `.${classes.join(".")}`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    const visible = (element, rect) => {
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
    };

    const selector = "button,[role=status],[aria-label],dialog,[role=dialog],aside,.cinematic-seat,.hand-winner-banner,.winner-announcement,.targeted-emote-panel,.settings-modal,.action-tray,.mobile-action-tray";
    const elements = Array.from(document.querySelectorAll(selector))
      .filter((element) => visible(element, element.getBoundingClientRect()))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: pathFor(element),
          role: element.getAttribute("role"),
          aria: element.getAttribute("aria-label"),
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 140),
          rect: [rect.x, rect.y, rect.width, rect.height].map((value) => Number(value.toFixed(1))),
          overflow: [element.clientWidth, element.scrollWidth, element.clientHeight, element.scrollHeight],
        };
      });

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const labels = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (!text || text.length > 80 || !node.parentElement) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (!visible(node.parentElement, rect)) continue;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
      const centerX = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const centerY = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const top = document.elementFromPoint(centerX, centerY);
      const obscured = Boolean(top && top !== node.parentElement && !node.parentElement.contains(top) && !top.contains(node.parentElement));
      labels.push({
        text,
        selector: pathFor(node.parentElement),
        rect: [rect.x, rect.y, rect.width, rect.height].map((value) => Number(value.toFixed(1))),
        clipped: rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5,
        obscured,
        topSelector: obscured ? pathFor(top) : null,
      });
    }

    const intersections = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        const [ax, ay, aw, ah] = a.rect;
        const [bx, by, bw, bh] = b.rect;
        const width = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
        const height = Math.min(ay + ah, by + bh) - Math.max(ay, by);
        if (width > 1 && height > 1 && a.selector !== b.selector) {
          intersections.push({ a: `${a.text} @ ${a.selector}`, b: `${b.text} @ ${b.selector}`, overlap: [Number(width.toFixed(1)), Number(height.toFixed(1))] });
        }
      }
    }

    return {
      viewport: [innerWidth, innerHeight],
      elements,
      clippedLabels: labels.filter((item) => item.clipped),
      obscuredLabels: labels.filter((item) => item.obscured),
      intersections,
      horizontalOverflow: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
    };
  });
}
