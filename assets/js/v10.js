/* Maknana website v10 (10 November 2026): solution finder, the scroll-built cell, the three packages, the trial tracks. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rtl = document.documentElement.dir === "rtl";

  // tabs with panels: arrow keys move, Home and End jump (WAI-ARIA tabs pattern)
  function tabs(root, tabSel, onPick) {
    const ts = $$(tabSel, root);
    const pick = (i, focus) => {
      ts.forEach((t, j) => {
        const on = j === i; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1;
        const p = document.getElementById(t.getAttribute("aria-controls"));
        if (p) { p.hidden = !on; p.classList.toggle("on", on); }
      });
      if (focus) ts[i].focus();
      if (onPick) onPick(i);
    };
    ts.forEach((t, i) => {
      t.addEventListener("click", () => pick(i));
      t.addEventListener("keydown", e => {
        const fwd = ["ArrowDown", rtl ? "ArrowLeft" : "ArrowRight"], back = ["ArrowUp", rtl ? "ArrowRight" : "ArrowLeft"];
        let n = null;
        if (fwd.includes(e.key)) n = (i + 1) % ts.length; else if (back.includes(e.key)) n = (i - 1 + ts.length) % ts.length;
        else if (e.key === "Home") n = 0; else if (e.key === "End") n = ts.length - 1;
        if (n !== null) { e.preventDefault(); pick(n, true); }
      });
    });
    return pick;
  }

  // solution finder: pointing at a job previews it on desktop
  $$("[data-finder]").forEach(fd => {
    const pick = tabs(fd, ".fd-tab", i => {
      const v = $(`#fd-p${i} video`, fd); if (v && v.paused) v.play().catch(() => {});
      const t = $(`#fd-t${i}`, fd);
      if (t && innerWidth <= 900) { const l = $(".fd-list", fd); l.scrollTo({ left: t.offsetLeft - l.offsetLeft - 20, behavior: RM ? "auto" : "smooth" }); }
    });
    if (matchMedia("(hover: hover) and (min-width: 901px)").matches) {
      let timer = 0;
      $$(".fd-tab", fd).forEach((t, i) => {
        t.addEventListener("pointerenter", () => { clearTimeout(timer); timer = setTimeout(() => { if (t.getAttribute("aria-selected") !== "true") pick(i); }, 110); });
        t.addEventListener("pointerleave", () => clearTimeout(timer));
      });
    }
  });

  // trial page: the two tracks
  $$("[data-tracks]").forEach(tk => {
    const pick = tabs(tk, ".tk-tabs [role=tab]");
    if (location.hash === "#study") pick(1);
  });

  // three packages: the scale and the columns stay in step
  $$("[data-tiers]").forEach(tr => {
    const cols = $$(".tr-c", tr), paths = $$(".tr-p", tr), range = $("input[type=range]", tr);
    const set = i => {
      cols.forEach((c, j) => { c.classList.toggle("on", j === i); const b = $(".tr-b", c); if (b) b.setAttribute("aria-pressed", j === i); });
      paths.forEach((p, j) => p.classList.toggle("on", j === i));
      if (range && +range.value !== i) range.value = i;
    };
    cols.forEach((c, i) => c.addEventListener("click", () => set(i)));
    if (range) range.addEventListener("input", () => set(+range.value));
  });

  // the scroll-built cell: scrolling adds one part at a time; the 3D stage follows through its assembly interface
  $$("[data-anatomy]").forEach(sec => {
    const steps = $$(".an-s", sec), mob = $$(".anat-m li", sec), stage = $("[data-robot]", sec), prog = $(".an-prog", sec), n = steps.length;
    if (RM) sec.classList.add("static");
    let cur = -1, target = RM ? n : 1, shown = target, raf = 0;
    const cell = () => (stage && stage.__cell && stage.__cell.setAssembly ? stage.__cell : null);
    const paint = k => {                       // k = the step in view, 1..n
      if (k === cur) return; cur = k;
      steps.forEach((s, j) => { s.classList.toggle("on", j < k); s.classList.toggle("cur", j === k - 1); $(".an-b", s).setAttribute("aria-current", j === k - 1 ? "step" : "false"); });
      mob.forEach((s, j) => s.classList.toggle("cur", j === k - 1));
      const c = cell(); if (c && c.focusPart) c.focusPart(steps[k - 1] ? steps[k - 1].dataset.part : null);
    };
    const tick = () => {
      raf = 0; shown += (target - shown) * 0.14;
      if (Math.abs(target - shown) < 0.002) shown = target; else raf = requestAnimationFrame(tick);
      const c = cell(); if (c) c.setAssembly(shown);
      if (prog) prog.style.setProperty("--p", Math.min(1, shown / n).toFixed(4));
    };
    const go = v => { target = Math.max(0.0001, Math.min(n, v)); if (!raf) raf = requestAnimationFrame(tick); };
    const pin = $(".anat-pin", sec);
    const pinned = () => getComputedStyle(pin).position === "sticky";
    const onScroll = () => {
      if (RM) { paint(n); go(n); return; }
      if (pinned()) {
        const r = sec.getBoundingClientRect(), span = r.height - innerHeight;
        const p = Math.max(0, Math.min(1, -r.top / Math.max(1, span)));
        const v = 1 + p * (n - 0.02);          // 1 to n: the robot stands from the start, then one part per screen of scroll
        go(Math.min(n, v)); paint(Math.max(1, Math.min(n, Math.floor(v + 0.35))));
      } else if (mob.length) {                 // phones: the list scrolls under the pinned stage
        const mid = innerHeight * 0.72; let k = 1;
        mob.forEach((li, j) => { if (li.getBoundingClientRect().top < mid) k = j + 1; });
        paint(k); go(k);
      }
    };
    addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll);
    if (stage) stage.addEventListener("cell:ready", () => { const c = cell(); if (c) { c.setAssembly(shown); cur = -1; onScroll(); } });
    steps.forEach((s, j) => $(".an-b", s).addEventListener("click", () => {
      if (!pinned()) return;
      const r = sec.getBoundingClientRect(), span = r.height - innerHeight, y = scrollY + r.top + span * ((j + 0.15) / (n - 0.02));
      scrollTo({ top: y, behavior: RM ? "auto" : "smooth" });
    }));
    onScroll();
  });
})();
