/* Maknana website — interactions (vanilla JS, no dependencies). Version 2. */
(() => {
  // opened from disk: module scripts and model files cannot load, so the 3D studios show their stills
  if (location.protocol === "file:") document.documentElement.classList.add("is-file");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HOVER = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const RTL = document.documentElement.dir === "rtl";
  const AR = document.documentElement.lang === "ar";
  const fmt = (v, d = 0) => v.toLocaleString(AR ? "en-US" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  window.MK = { fmt, AR, RTL, RM };

  /* ---------- yellow "to confirm" fields: show or hide (remembered per viewer) ---------- */
  const tbcBtn = $("[data-tbc-toggle]");
  if (tbcBtn) {
    const L = AR ? ["إخفاء", "إظهار"] : ["Hide", "Show"];
    const set = off => { document.documentElement.classList.toggle("tbc-off", off); tbcBtn.textContent = off ? L[1] : L[0]; tbcBtn.setAttribute("aria-pressed", off); };
    let off = false; try { off = localStorage.getItem("mk-tbc") === "off"; } catch (e) {}
    set(off);
    tbcBtn.addEventListener("click", () => { off = !off; set(off); try { localStorage.setItem("mk-tbc", off ? "off" : "on"); } catch (e) {} });
  }

  /* ---------- time-limited notice ---------- */
  const notice = $(".notice");
  if (notice) {
    const end = new Date(notice.dataset.until);
    let closed = false;
    try { closed = sessionStorage.getItem("mk-notice") === "x"; } catch (e) {}
    if (new Date() > end || closed) notice.remove();
    else {
      document.body.classList.add("has-notice");
      const setH = () => document.body.style.setProperty("--nh", notice.offsetHeight + "px");
      setH(); addEventListener("resize", setH);
      $("button", notice).addEventListener("click", () => {
        notice.remove(); document.body.classList.remove("has-notice");
        try { sessionStorage.setItem("mk-notice", "x"); } catch (e) {}
      });
    }
  }

  /* ---------- nav: theme follows the section under it, hides on scroll down ---------- */
  const nav = $(".nav");
  const themed = $$("[data-theme]");
  let lastY = scrollY;
  const navState = () => {
    const y = scrollY;
    nav.classList.toggle("top", y < 20);
    nav.classList.toggle("scrolled", y > 40);
    const probe = (parseFloat(getComputedStyle(nav).top) || 0) + 32;   // the bar's resting place, not its slid-away transform
    let dark = false;
    for (const s of themed) {
      const r = s.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) { dark = s.dataset.theme === "dark"; break; }
    }
    nav.classList.toggle("on-dark", dark);
    if (!document.body.classList.contains("menu-open") && !nav.classList.contains("mega-on")) nav.classList.toggle("hide", y > lastY && y > 500);
    lastY = y;
  };
  addEventListener("scroll", navState, { passive: true });
  navState();

  /* the yellow-field legend steps aside over the footer (body.foot-in), so it never covers a footer link */
  const foot = $(".foot");
  if (foot && $(".tbc-legend") && "IntersectionObserver" in window)
    new IntersectionObserver(es => es.forEach(e => document.body.classList.toggle("foot-in", e.isIntersecting))).observe(foot);

  /* mega menus: hover on desktop, click anywhere, Escape closes */
  const mms = $$(".mm");
  let mmTimer;
  const closeAll = () => { mms.forEach(m => { m.classList.remove("open"); $(".mm-b", m).setAttribute("aria-expanded", "false"); }); nav.classList.remove("mega-on"); };
  const openMM = m => { mms.forEach(x => { if (x !== m) { x.classList.remove("open"); $(".mm-b", x).setAttribute("aria-expanded", "false"); } }); m.classList.add("open"); $(".mm-b", m).setAttribute("aria-expanded", "true"); nav.classList.add("mega-on"); nav.classList.remove("hide"); };
  mms.forEach(m => {
    const b = $(".mm-b", m);
    b.addEventListener("click", e => { e.stopPropagation(); m.classList.contains("open") ? closeAll() : openMM(m); });
    if (HOVER) {
      m.addEventListener("pointerenter", () => { clearTimeout(mmTimer); mmTimer = setTimeout(() => openMM(m), 90); });
      m.addEventListener("pointerleave", () => { clearTimeout(mmTimer); mmTimer = setTimeout(closeAll, 180); });
    }
  });
  document.addEventListener("click", e => { if (!e.target.closest(".mm")) closeAll(); });
  addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });
  const veil = $(".mega-veil"); if (veil) veil.addEventListener("click", closeAll);

  const burger = $(".burger");
  if (burger) burger.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    burger.setAttribute("aria-expanded", open);
    nav.classList.remove("hide");
  });
  $$(".drawer a").forEach(a => a.addEventListener("click", () => document.body.classList.remove("menu-open")));
  addEventListener("keydown", e => {
    if (e.key !== "Escape" || !document.body.classList.contains("menu-open")) return;
    document.body.classList.toggle("menu-open", false);
    if (burger) { burger.setAttribute("aria-expanded", "false"); burger.focus(); }
  });

  /* ---------- page changes: load bar and prefetch on intent ---------- */
  const bar = $(".loadbar");
  const pre = new Set();
  $$("a[href]").forEach(a => {
    const u = a.getAttribute("href");
    if (!u || u.startsWith("#") || u.startsWith("http") || u.startsWith("mailto:") || u.startsWith("tel:") || a.target === "_blank" || a.hasAttribute("download") || a.dataset.film !== undefined) return;
    a.addEventListener("click", e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; if (bar) bar.classList.add("go"); });
    a.addEventListener("pointerenter", () => {
      const abs = new URL(u, location.href).href.split("#")[0];
      if (pre.has(abs) || abs === location.href.split("#")[0]) return;
      pre.add(abs);
      const l = document.createElement("link"); l.rel = "prefetch"; l.href = abs; document.head.appendChild(l);
    }, { once: true });
  });
  addEventListener("pageshow", () => bar && bar.classList.remove("go"));

  /* ---------- reveal on scroll ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); e.target.dispatchEvent(new Event("reveal")); }
  }), { threshold: 0.16, rootMargin: "0px 0px -6% 0px" });
  $$(".rv, .rv-scale, [data-reveal], .tl, .beam").forEach(el => io.observe(el));
  $$("[data-stagger]").forEach(g => Array.from(g.children).forEach((c, i) => c.style.setProperty("--d", (i * 0.09) + "s")));

  /* ---------- counters ---------- */
  const count = el => {
    const to = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0), dur = 1600;
    const p0 = el.dataset.pre || "", s0 = el.dataset.suf || "";
    if (RM) { el.textContent = p0 + fmt(to, dec) + s0; return; }
    const t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = p0 + fmt(to * e, dec) + s0;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const cio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { count(e.target); cio.unobserve(e.target); } }), { threshold: .6 });
  $$("[data-count]").forEach(el => cio.observe(el));

  /* ---------- bars and gauges ---------- */
  const bio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    $$("[data-w]", e.target).forEach(b => { b.style.width = b.dataset.w; });
    $$("[data-h]", e.target).forEach(b => { b.style.height = b.dataset.h; });
    bio.unobserve(e.target);
  }), { threshold: .35 });
  $$("[data-bars]").forEach(el => bio.observe(el));

  
  if ($(".ask-bar")) {   // nothing on the first screen is ever covered: the bar waits for a first scroll and for the hero buttons to leave
    const firstBtns = $(".hero .btn-row, .ph .btn-row");
    let btnsOn = !!firstBtns, moved = scrollY > 160;
    const upd = () => document.body.classList.toggle("ask-wait", btnsOn || !moved);
    if (firstBtns && "IntersectionObserver" in window) new IntersectionObserver(es => { btnsOn = es[0].isIntersecting; upd(); }).observe(firstBtns);
    else btnsOn = false;
    addEventListener("scroll", () => { const m = scrollY > 160; if (m !== moved) { moved = m; upd(); } }, { passive: true });
    upd();
  }

  /* ---------- statement: words light up as you scroll ---------- */
  $$(".statement").forEach(st => {
    const ws = $$(".w", st);
    const upd = () => {
      const r = st.getBoundingClientRect(), vh = innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.9 - r.top) / (r.height + vh * 0.1)));
      const n = Math.round(p * ws.length);
      ws.forEach((w, i) => w.classList.toggle("on", i < n));
    };
    if (RM) ws.forEach(w => w.classList.add("on")); else { addEventListener("scroll", upd, { passive: true }); upd(); }
  });

  /* ---------- hero: gentle zoom-out on scroll ---------- */
  const hero = $(".hero .media");
  if (hero && !RM) addEventListener("scroll", () => {
    const y = Math.min(scrollY, innerHeight);
    hero.style.transform = `scale(${1.08 - y / innerHeight * 0.08}) translateY(${y * 0.18}px)`;
  }, { passive: true });

  /* ---------- muted films: play only while on screen; tiles play on hover where there is a mouse ---------- */
  const vio = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (v.dataset.manual) return;
    v._in = e.isIntersecting;
    if (e.isIntersecting && !RM) {
      const go = () => { if (v._in) v.play().catch(() => {}); };
      if (v.readyState < 2) { if (v.preload === "none") v.preload = "auto"; v.addEventListener("canplay", go, { once: true }); }
      go();
    } else if (!e.isIntersecting) v.pause();
  }), { threshold: .2 });
  $$("video[data-auto]").forEach(v => {
    v.muted = true;
    const tile = v.closest(".app-tile, .film-card");
    if (tile && HOVER) {
      v.dataset.manual = "1"; v.preload = "metadata";
      tile.addEventListener("pointerenter", () => v.play().catch(() => {}));
      tile.addEventListener("pointerleave", () => v.pause());
      return;
    }
    vio.observe(v);
  });

  /* ---------- cards: glow follows the pointer ---------- */
  $$(".glow").forEach(c => c.addEventListener("pointermove", e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px");
    c.style.setProperty("--my", (e.clientY - r.top) + "px");
  }));

  /* ---------- button ripple ---------- */
  $$(".btn").forEach(b => b.addEventListener("pointerdown", e => {
    const r = b.getBoundingClientRect(), s = document.createElement("span"), d = Math.max(r.width, r.height);
    s.className = "ripple"; s.style.width = s.style.height = d + "px";
    s.style.left = (e.clientX - r.left - d / 2) + "px"; s.style.top = (e.clientY - r.top - d / 2) + "px";
    b.appendChild(s); setTimeout(() => s.remove(), 650);
  }));

  /* ---------- film modal: one file, or several parts played back to back as one film ---------- */
  const modal = $(".modal");
  if (modal) {
    const stage = $(".modal-stage", modal);
    let vids = [], cur = 0, durs = [], total = 0, ui = null;
    const pos = () => durs.slice(0, cur).reduce((a, b) => a + b, 0) + (vids[cur] ? vids[cur].currentTime : 0);
    const paint = () => {
      if (!ui || !total) return;
      const p = Math.min(1, pos() / total) * 100;
      ui.i.style.width = p + "%"; ui.b.style[RTL ? "right" : "left"] = p + "%";
      const s = Math.floor(pos()), t = Math.floor(total);
      ui.t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} / ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      if (vids[cur] && !vids[cur].paused) requestAnimationFrame(paint);
    };
    const show = (k, t = 0, play = true) => {
      vids.forEach((v, i) => { v.classList.toggle("on", i === k); if (i !== k) v.pause(); });
      cur = k; const v = vids[k]; v.currentTime = t;
      if (play) v.play().catch(() => {});
      if (vids[k + 1]) vids[k + 1].preload = "auto";
      requestAnimationFrame(paint);
    };
    const open = srcs => {
      stage.innerHTML = ""; vids = []; durs = []; total = 0; cur = 0;
      srcs.forEach((s, i) => {
        const v = document.createElement("video");
        v.src = s; v.playsInline = true; v.preload = i === 0 ? "auto" : "metadata";
        if (srcs.length > 1) v.className = "part"; else v.controls = true;
        v.addEventListener("loadedmetadata", () => { durs[i] = v.duration; total = durs.reduce((a, b) => a + (b || 0), 0); paint(); });
        v.addEventListener("ended", () => { if (vids[i + 1]) show(i + 1); else ui && ui.p.classList.add("ended"); });
        v.addEventListener("play", () => { if (ui) ui.p.innerHTML = ICON.pause; requestAnimationFrame(paint); });
        v.addEventListener("pause", () => { if (ui && v === vids[cur]) ui.p.innerHTML = ICON.play; });
        stage.appendChild(v); vids.push(v);
      });
      ui = null;
      if (srcs.length > 1) {
        const barEl = document.createElement("div"); barEl.className = "mp-bar";
        barEl.innerHTML = `<button type="button" class="mp-p" aria-label="Play">${ICON.pause}</button><div class="mp-track" role="slider" aria-label="Seek" tabindex="0"><i></i><b></b></div><span class="mp-t">0:00</span><button type="button" class="mp-m" aria-label="Sound">${ICON.vol}</button>`;
        stage.appendChild(barEl);
        ui = { p: $(".mp-p", barEl), i: $(".mp-track i", barEl), b: $(".mp-track b", barEl), t: $(".mp-t", barEl), m: $(".mp-m", barEl), tr: $(".mp-track", barEl) };
        ui.p.addEventListener("click", () => { const v = vids[cur]; if (v.paused) { if (v.ended && !vids[cur + 1]) show(0); else v.play(); } else v.pause(); });
        ui.m.addEventListener("click", () => { const m = !vids[0].muted; vids.forEach(v => v.muted = m); ui.m.innerHTML = m ? ICON.mute : ICON.vol; });
        const seek = e => {
          const r = ui.tr.getBoundingClientRect(); let f = (e.clientX - r.left) / r.width; if (RTL) f = 1 - f;
          let t = Math.max(0, Math.min(1, f)) * total, k = 0;
          while (k < durs.length - 1 && t > durs[k]) { t -= durs[k]; k++; }
          show(k, t, !vids[cur].paused || true);
        };
        ui.tr.addEventListener("click", seek);
      }
      modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
      vids[0].muted = false;
      show(0);
      $(".x", modal).focus();
    };
    const close = () => { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); vids.forEach(v => v.pause()); setTimeout(() => { if (!modal.classList.contains("open")) stage.innerHTML = ""; }, 400); };
    $$("[data-film]").forEach(b => b.addEventListener("click", e => { e.preventDefault(); open(b.dataset.film.split(",")); }));
    $(".x", modal).addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("open")) close(); if (e.key === " " && modal.classList.contains("open") && ui) { e.preventDefault(); ui.p.click(); } });
  }
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 010 7"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
  };

  /* ---------- photo zoom ---------- */
  const zooms = $$("[data-zoom]");
  if (zooms.length) {
    const lb = document.createElement("div"); lb.className = "lightbox"; lb.setAttribute("role", "dialog");
    lb.innerHTML = `<button class="x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg></button><img alt="">`;
    document.body.appendChild(lb);
    const im = $("img", lb);
    const shut = () => lb.classList.remove("open");
    zooms.forEach(z => z.addEventListener("click", () => { const s = $("img", z); im.src = s.currentSrc.replace("/sm/", "/").replace("/md/", "/"); im.alt = s.alt; lb.classList.add("open"); }));
    lb.addEventListener("click", shut); addEventListener("keydown", e => { if (e.key === "Escape") shut(); });
  }

  /* ---------- level tabs ---------- */
  $$("[data-levels]").forEach(box => {
    const tabs = $$(".lv-tab", box), imgs = $$(".lv-view img", box), seg = $$(".scope i", box);
    let timer, cur = 0;
    const show = (i, user) => {
      cur = i;
      tabs.forEach((t, k) => t.setAttribute("aria-selected", k === i));
      imgs.forEach((m, k) => m.classList.toggle("on", k === i));
      seg.forEach((s, k) => s.classList.toggle("on", k <= i));
      if (user) clearInterval(timer);
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", e => { if (e.target.closest("a")) return; show(i, true); });
      t.addEventListener("keydown", e => {
        const k = e.key;
        if (k === "ArrowDown" || k === (RTL ? "ArrowLeft" : "ArrowRight")) { e.preventDefault(); tabs[(i + 1) % tabs.length].focus(); show((i + 1) % tabs.length, true); }
        if (k === "ArrowUp" || k === (RTL ? "ArrowRight" : "ArrowLeft")) { e.preventDefault(); const j = (i - 1 + tabs.length) % tabs.length; tabs[j].focus(); show(j, true); }
      });
    });
    box.addEventListener("reveal", () => { if (!RM) timer = setInterval(() => show((cur + 1) % tabs.length), 5200); });
    show(0);
  });

  /* ---------- film with synced chapters ---------- */
  $$("[data-chapters]").forEach(box => {
    const v = $("video", box), chaps = $$(".chap", box), times = chaps.map(c => parseFloat(c.dataset.t));
    const arrow = $(".film-arrow i", box), film = $(".film", box), ctl = $(".ctl", box);
    v.dataset.manual = "1";
    const tick = () => {
      const t = v.currentTime, D = v.duration || parseFloat(box.dataset.dur);
      let k = 0; times.forEach((s, i) => { if (t >= s) k = i; });
      chaps.forEach((c, i) => {
        c.classList.toggle("on", i === k);
        c.classList.toggle("done", i < k);
        const s = times[i], e = i + 1 < times.length ? times[i + 1] : D;
        const b = $(".bar i", c);
        if (b) b.style.width = (i < k ? 100 : i === k ? Math.min(100, (t - s) / (e - s) * 100) : 0) + "%";
      });
      if (arrow) arrow.style.width = (t / D * 100) + "%";
      if (!v.paused) requestAnimationFrame(tick);
    };
    v.addEventListener("play", () => { film.classList.remove("paused"); requestAnimationFrame(tick); });
    v.addEventListener("pause", () => film.classList.add("paused"));
    v.addEventListener("ended", () => { film.classList.add("paused"); chaps.forEach(c => c.classList.add("done")); tick(); });
    v.addEventListener("seeked", tick);
    chaps.forEach((c, i) => c.addEventListener("click", () => { v.currentTime = times[i] + 0.05; v.play().catch(() => {}); }));
    if (ctl) ctl.addEventListener("click", () => { if (v.paused || v.ended) { if (v.ended) v.currentTime = 0; v.play().catch(() => {}); } else v.pause(); });
    const fio = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !RM && !box.dataset.played && !matchMedia("(max-width: 820px)").matches) { box.dataset.played = 1; v.play().catch(() => {}); }
      else if (!e.isIntersecting) v.pause();
    }), { threshold: .45 });
    fio.observe(v);
    film.classList.add("paused");
  });

  /* ---------- split-screen film: drag the handle ---------- */
  $$("[data-split]").forEach(box => {
    const h = $(".sv-handle", box), vids = $$("video", box);
    let x = 50, drag = false;
    const set = p => { x = Math.max(4, Math.min(96, p)); box.style.setProperty("--x", x + "%"); h.setAttribute("aria-valuenow", Math.round(x)); };
    const at = cx => { const r = box.getBoundingClientRect(); let f = (cx - r.left) / r.width * 100; if (RTL) f = 100 - f; set(f); };
    box.addEventListener("pointerdown", e => { drag = true; at(e.clientX); box.setPointerCapture && box.setPointerCapture(e.pointerId); });
    box.addEventListener("pointermove", e => { if (drag || (HOVER && e.pointerType === "mouse" && e.buttons === 0 && box.dataset.follow)) at(e.clientX); });
    addEventListener("pointerup", () => { drag = false; });
    h.addEventListener("keydown", e => { const d = (e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0) * (RTL ? -1 : 1); if (d) { e.preventDefault(); set(x + d); } });
    // a gentle hint the first time it is seen
    const sio = new IntersectionObserver(es => { if (es[0].isIntersecting && !RM) { sio.disconnect(); let t0 = performance.now(); const sw = t => { const p = (t - t0) / 1600; if (p > 1 || drag) return set(50); set(50 + Math.sin(p * Math.PI * 2) * 18); requestAnimationFrame(sw); }; requestAnimationFrame(sw); } }, { threshold: .5 });
    sio.observe(box);
    vids.forEach(v => v.addEventListener("play", () => { const o = vids.find(w => w !== v); if (o && Math.abs(o.currentTime - v.currentTime) > 0.3) o.currentTime = v.currentTime; }));
  });

  /* ---------- horizontal gallery arrows ---------- */
  $$("[data-gal]").forEach(g => {
    const track = $(".gal", g);
    $$(".gal-nav button", g).forEach(b => b.addEventListener("click", () => {
      const dir = (b.dataset.dir === "next" ? 1 : -1) * (RTL ? -1 : 1);
      track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: "smooth" });
    }));
  });

  /* ---------- receive -> ship flow ---------- */
  $$("[data-flow]").forEach(f => {
    const its = $$(".flow-i", f), prog = $(".fl-prog", f);
    io.observe(f);
    f.addEventListener("reveal", () => {
      its.forEach((it, i) => setTimeout(() => {
        it.classList.add("on");
        if (prog) prog.style.width = (i / (its.length - 1) * 80) + "%";
      }, RM ? 0 : 350 + i * 520));
    });
  });

  /* ---------- sticky sub-navigation on product pages ---------- */
  const sub = $(".subnav");
  if (sub) {
    const links = $$("a[href^='#']", sub), secs = links.map(a => $(a.getAttribute("href"))).filter(Boolean);
    const upd = () => {
      const top = sub.getBoundingClientRect().top;
      document.body.classList.toggle("sub-on", top <= 1);
      let k = -1; secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) k = i; });
      links.forEach((a, i) => a.classList.toggle("on", i === k));
    };
    addEventListener("scroll", upd, { passive: true }); upd();
  }

  /* ---------- quick value calculator (home and solution pages) ---------- */
  const CD = (() => { const s = $("#calc-data"); try { return s ? JSON.parse(s.textContent) : null; } catch (e) { return null; } })();
  $$("[data-mini-calc]").forEach(c => {
    if (!CD) return;
    let app = "welding";
    const qa = new URLSearchParams(location.search).get("app"), qb = qa && $(`[data-app="${qa}"]`, c);   // a solution page opens the estimator on its own job
    if (qb && CD.apps[qa]) { app = qa; $$("[data-app]", c).forEach(x => x.setAttribute("aria-pressed", x === qb)); }
    const q = n => $(`[name="${n}"]`, c), out = (n, s) => { const o = $(`[data-o="${n}"]`, c); if (o) { if (AR) o.innerHTML = `<span class="ltr">${s}</span>`; else o.textContent = s; } };
    const paint = r => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%");
    const calc = () => {
      const a = CD.apps[app], cells = +q("cells").value, sh = +q("shifts").value;
      [q("cells"), q("shifts")].forEach(paint);
      const freed = cells * (a.crew_before - a.crew_after) * sh;
      const save = freed * CD.wage * 12 - cells * a.opex * sh;
      const step = save > 400000 ? 50000 : 10000;   // an indicative range (20% either side), in round figures
      out("cells", cells); out("shifts", sh);
      out("roles", fmt(freed, freed % 1 ? 1 : 0));
      out("save", save > 0 ? fmt(Math.max(step, Math.floor(save * .8 / step) * step)) + "–" + fmt(Math.ceil(save * 1.2 / step) * step) : "—");
      const arcBox = $(".mc-arc", c);
      if (arcBox) arcBox.hidden = app !== "welding";
    };
    $$("[data-app]", c).forEach(b => b.addEventListener("click", () => { app = b.dataset.app; $$("[data-app]", c).forEach(x => x.setAttribute("aria-pressed", x === b)); calc(); }));
    $$("input", c).forEach(i => i.addEventListener("input", calc));
    calc();
  });

  /* ---------- contact: compose the request for WhatsApp or e-mail (no data is stored) ---------- */
  const form = $("[data-request]");
  if (form) {
    const svc = new URLSearchParams(location.search).get("service");   // from Services' "Request maintenance" (?service=maintenance)
    const maint = svc === "maintenance";
    if (maint) {   // tick "Service" and greet for a maintenance visit instead of an application study
      const box = $(`input[name="process"][value="${form.dataset.svc}"]`, form);
      if (box) box.checked = true;
    }
    const compose = () => {
      const d = new FormData(form), L = form.dataset;
      const procs = d.getAll("process").join(document.documentElement.lang === "ar" ? "، " : ", ");
      const extra = new URLSearchParams(location.search).get("estimate");
      const lines = [
        maint && L.helloMaint ? L.helloMaint : L.hello,
        `${L.lName}: ${d.get("name") || "-"}`, `${L.lCompany}: ${d.get("company") || "-"}`, `${L.lCity}: ${d.get("city") || "-"}`,
        `${L.lProcess}: ${procs || "-"}`, `${L.lShifts}: ${d.get("shifts") || "-"}`, `${L.lPart}: ${d.get("part") || "-"}`,
        `${L.lPhone}: ${d.get("phone") || "-"}`, `${L.lEmail}: ${d.get("email") || "-"}`
      ];
      const files = [...((form.querySelector('input[type="file"]') || {}).files || [])].map(f => f.name);
      if (files.length) lines.push(`${L.lFiles}: ${files.join(", ")}`, L.attach || "");
      if (extra) lines.push("", extra);
      const mach = new URLSearchParams(location.search).get("machine");   // from the machinery catalogue's "Ask about it"
      if (mach) lines.push("", `${L.lMachine || (document.documentElement.lang === "ar" ? "الماكينة" : "Machine")}: ${mach}`);
      return lines.join("\n");
    };
    const fpick = $(".fpick-in", form), fnames = $(".fpick-names", form);
    if (fpick && fnames) fpick.addEventListener("change", () => { const n = [...fpick.files].map(f => f.name); fnames.textContent = n.length ? n.join(", ") : fnames.dataset.none; });
    const res = $(".form-result");
    const waBtn = $("[data-wa]", res);   // present only when WhatsApp is enabled
    const waBase = waBtn ? (waBtn.getAttribute("href") || "").split("?")[0] : "";
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const msg = compose();
      if (waBtn) waBtn.href = `${waBase}?text=${encodeURIComponent(msg)}`;
      $("[data-mail]", res).href = `mailto:info@maknana.sa?subject=${encodeURIComponent(maint && form.dataset.subjectMaint ? form.dataset.subjectMaint : form.dataset.subject)}&body=${encodeURIComponent(msg)}`;
      $("textarea", res).value = msg;
      const fin = form.querySelector('input[type="file"]'), share = $("[data-share]", res);
      const fl = fin && fin.files ? [...fin.files] : [];
      if (share) {   // phones: share the drawing or photo straight to WhatsApp or mail (the site uploads nothing)
        const ok = fl.length && navigator.canShare && navigator.canShare({ files: fl });
        share.hidden = !ok;
        share.onclick = () => navigator.share({ files: fl, text: msg }).catch(() => {});
      }
      res.hidden = false;
      res.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" });
      (waBtn || $("[data-mail]", res)).focus();
    });
    const copy = $("[data-copy]", res);
    copy.addEventListener("click", () => {
      const t = $("textarea", res);
      const done = () => { copy.textContent = copy.dataset.done; setTimeout(() => copy.textContent = copy.dataset.label, 2000); };
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(done, () => { t.select(); });
    });
  }

  /* ---------- year ---------- */
  $$("[data-year]").forEach(y => y.textContent = new Date().getFullYear());
})();

/* product menu links: open the family (and scroll to the sub-category) that the address points to */
(() => {
  const go = () => {
    const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    const t = document.getElementById(id); if (!t) return;
    const fam = t.closest("details.cat-fam") || (t.matches("details.cat-fam") ? t : null);
    if (fam && !fam.open) fam.open = true;
    document.querySelectorAll(".rv").forEach(x => x.classList.add("in"));
    requestAnimationFrame(() => t.scrollIntoView({ block: "start" }));
  };
  window.addEventListener("hashchange", go);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();

/* product pages: thumbnails switch the main photograph; the main photograph opens full size */
(() => {
  const main = document.querySelector(".pr-main"); if (!main) return;
  const im = main.querySelector("img");
  document.querySelectorAll(".pr-th").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".pr-th").forEach(x => x.classList.toggle("on", x === b));
    im.removeAttribute("srcset"); im.src = b.dataset.img;
  }));
  const dlg = document.createElement("dialog"); dlg.className = "pr-lb";
  dlg.innerHTML = '<button type="button" aria-label="Close">×</button><img alt="">';
  document.body.appendChild(dlg);
  dlg.querySelector("button").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
  main.addEventListener("click", () => { const big = dlg.querySelector("img"); big.src = (im.currentSrc || im.src).replace("/products/sm/", "/products/md/"); big.alt = im.alt; dlg.showModal(); });
})();
