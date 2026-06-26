// VectorAI DB homepage — application entry.
// Styles are imported here so Vite bundles and hashes them.
import './styles/fonts.css';
import './styles/main.css';

const svgNS = 'http://www.w3.org/2000/svg';

// ── NAV SCROLL ──
const nav = document.getElementById('nav')!;
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });

// ── MOBILE NAV (hamburger) ──
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
function setNav(open: boolean): void {
  document.body.classList.toggle('nav-open', open);
  navToggle?.setAttribute('aria-expanded', String(open));
}
navToggle?.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
// close the menu after tapping any link or button inside it
navMenu?.querySelectorAll('a, button').forEach((el) => el.addEventListener('click', () => setNav(false)));

// ── COPY HELPERS ──
function copyText(btn: HTMLElement, txt: string): void {
  navigator.clipboard.writeText(txt).then(() => {
    btn.innerHTML = '<i class="ti ti-check"></i>Copied';
    setTimeout(() => (btn.innerHTML = '<i class="ti ti-copy"></i>Copy'), 1800);
  });
}
// Buttons with a literal string to copy.
document.querySelectorAll<HTMLElement>('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', () => copyText(btn, btn.dataset.copy ?? ''));
});
// Buttons that copy the currently displayed code snippet.
document.querySelectorAll<HTMLElement>('[data-copy-code]').forEach((btn) => {
  btn.addEventListener('click', () => copyText(btn, currentSnippet.plain));
});

// ── AGENT MEMORY LOOP VISUALISATION ──
// An agent reasoning cycle (observe → reason → act → write → recall) circling a
// central VectorAI DB memory hub. A packet glides the loop; at write/recall it
// pulses to/from the hub and surfaces the retrieval readout. Honours reduced motion.
interface LoopNode {
  name: string;
  x: number;
  y: number;
  len: number; // arc-length position along the loop path
  el: SVGCircleElement;
  litAt: number;
}
interface Pt {
  x: number;
  y: number;
}

const vs = document.getElementById('vspace') as SVGSVGElement | null;
const readout = document.getElementById('vreadout');
const prefersReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STAGES = ['observe', 'reason', 'act', 'write', 'recall'];
const WRITE_I = 3;
const RECALL_I = 4;
const LOOP_MS = 6200;
const TRAIL = 11;
const NODE_FAINT = '#46639F';
const NODE_LABEL = '#92A6CE';
const RECALL_READOUT = '13ms &middot; memory recall &middot; 99.1%';

let W = 0,
  H = 0,
  nodes: LoopNode[] = [],
  loopPath: SVGPathElement | null = null,
  totalLen = 0,
  packet: SVGCircleElement | null = null,
  packetHalo: SVGCircleElement | null = null,
  trail: SVGCircleElement[] = [],
  hubGlow: SVGCircleElement | null = null,
  coreEls: SVGCircleElement[] = [],
  coreBaseR = 0,
  hubX = 0,
  hubY = 0,
  nodeR = 5,
  startT = 0,
  prevLen = 0,
  hubPulseAt = 0,
  readoutHideAt = 0,
  rafId = 0;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Closed Catmull-Rom spline through the points → smooth gliding loop (no corner snaps).
function smoothClosedPath(pts: Pt[]): string {
  const n = pts.length;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n],
      p1 = pts[i],
      p2 = pts[(i + 1) % n],
      p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6,
      c1y = p1.y + (p2.y - p0.y) / 6,
      c2x = p2.x - (p3.x - p1.x) / 6,
      c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d + ' Z';
}

function lengthAtPoint(path: SVGPathElement, pt: Pt): number {
  let best = 0,
    bestD = Infinity;
  const steps = 260;
  for (let i = 0; i <= steps; i++) {
    const L = (totalLen * i) / steps;
    const p = path.getPointAtLength(L);
    const dd = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = L;
    }
  }
  return best;
}

function el(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function buildSpace(): void {
  if (!vs) return;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  startT = 0;
  prevLen = 0;
  vs.innerHTML = '';
  nodes = [];
  trail = [];
  const r = vs.getBoundingClientRect();
  W = r.width;
  H = r.height;
  if (!W || !H) return;
  vs.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML =
    '<linearGradient id="vgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5CE8E0"/><stop offset=".5" stop-color="#49A2FF"/><stop offset="1" stop-color="#6E63FF"/></linearGradient>' +
    '<radialGradient id="hubGlass" cx="38%" cy="26%" r="90%"><stop offset="0" stop-color="#15295E"/><stop offset="1" stop-color="#05081C"/></radialGradient>' +
    '<radialGradient id="hubHalo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2E7BFF" stop-opacity=".5"/><stop offset="1" stop-color="#2E7BFF" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="packetGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#8FF4F0" stop-opacity=".9"/><stop offset="1" stop-color="#49A2FF" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="coreGrad" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#EAFCFF"/><stop offset=".22" stop-color="#7FE6EC"/><stop offset=".55" stop-color="#3C91FF"/><stop offset="1" stop-color="#0A1A46"/></radialGradient>' +
    '<filter id="bloom" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<filter id="soft" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="hubshadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="8" stdDeviation="13" flood-color="#02050F" flood-opacity="0.6"/></filter>';
  vs.appendChild(defs);

  const minWH = Math.min(W, H);
  hubX = W / 2;
  hubY = H / 2;
  const labelSize = Math.max(10, Math.min(15, Math.round(minWH * 0.026)));
  // clamp the ring so nodes AND their outer labels always stay inside the column
  const R = Math.max(
    70,
    Math.min(minWH * 0.34, W / 2 - (labelSize * 5.7 + 16), H / 2 - (labelSize * 1.5 + 22))
  );
  nodeR = Math.max(4, minWH * 0.013);
  const hubW = Math.min(124, Math.max(76, R * 0.64));

  // node ring positions (clockwise from top)
  const pts: Pt[] = STAGES.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / STAGES.length;
    return { x: hubX + R * Math.cos(a), y: hubY + R * Math.sin(a) };
  });

  // loop path: blurred glow underlay + crisp gradient ring
  const dPath = smoothClosedPath(pts);
  vs.appendChild(
    el('path', { d: dPath, fill: 'none', stroke: 'url(#vgrad)', 'stroke-width': '3.5', opacity: '0.16', filter: 'url(#soft)' })
  );
  loopPath = el('path', {
    d: dPath,
    fill: 'none',
    stroke: 'url(#vgrad)',
    'stroke-width': '1.3',
    opacity: '0.55',
  }) as SVGPathElement;
  vs.appendChild(loopPath);
  totalLen = loopPath.getTotalLength();

  // direction arrowheads at arc midpoints between consecutive nodes
  const nodeLens = pts.map((p) => lengthAtPoint(loopPath!, p));
  for (let i = 0; i < pts.length; i++) {
    const a = nodeLens[i];
    const b = i + 1 < pts.length ? nodeLens[i + 1] : totalLen + nodeLens[0];
    const midL = ((a + b) / 2) % totalLen;
    const m = loopPath.getPointAtLength(midL);
    const m2 = loopPath.getPointAtLength((midL + 1) % totalLen);
    const deg = (Math.atan2(m2.y - m.y, m2.x - m.x) * 180) / Math.PI;
    const head = el('path', {
      d: 'M -3.5 -3 L 3.5 0 L -3.5 3 Z',
      fill: 'url(#vgrad)',
      opacity: '0.55',
      transform: `translate(${m.x} ${m.y}) rotate(${deg})`,
    });
    vs.appendChild(head);
  }

  // spokes: write → hub, hub → recall
  [WRITE_I, RECALL_I].forEach((idx) => {
    const sp = el('line', {
      x1: String(pts[idx].x),
      y1: String(pts[idx].y),
      x2: String(hubX),
      y2: String(hubY),
      stroke: idx === WRITE_I ? '#FFB91E' : '#36D6D9',
      'stroke-width': '1',
      'stroke-dasharray': '3 4',
      opacity: '0.32',
    });
    vs.appendChild(sp);
  });

  // hub = the AGENT CORE (abstract): soft halo, pulsing ring, glowing energy orb
  vs.appendChild(
    el('circle', { cx: String(hubX), cy: String(hubY), r: String(hubW * 1.05), fill: 'url(#hubHalo)' })
  );
  hubGlow = el('circle', {
    cx: String(hubX),
    cy: String(hubY),
    r: String(hubW * 0.78),
    fill: 'none',
    stroke: 'url(#vgrad)',
    'stroke-width': '1.25',
    opacity: '0.2',
  }) as SVGCircleElement;
  vs.appendChild(hubGlow);

  const coreR = hubW * 0.46;
  coreBaseR = coreR;
  // diffuse glow under the orb
  vs.appendChild(el('circle', { cx: String(hubX), cy: String(hubY), r: String(coreR * 1.35), fill: 'url(#packetGlow)', opacity: '0.55' }));
  // orb body (glossy gradient sphere)
  const orb = el('circle', { cx: String(hubX), cy: String(hubY), r: String(coreR), fill: 'url(#coreGrad)' }) as SVGCircleElement;
  vs.appendChild(orb);
  // bright glowing rim
  const rim = el('circle', { cx: String(hubX), cy: String(hubY), r: String(coreR), fill: 'none', stroke: 'url(#vgrad)', 'stroke-width': '1.5', opacity: '0.7', filter: 'url(#bloom)' }) as SVGCircleElement;
  vs.appendChild(rim);
  coreEls = [orb, rim];
  // faint inner orbit ring for depth
  vs.appendChild(el('circle', { cx: String(hubX), cy: String(hubY), r: String(coreR * 0.6), fill: 'none', stroke: 'rgba(180,220,255,.35)', 'stroke-width': '1' }));
  // glossy specular sheen
  vs.appendChild(el('ellipse', { cx: String(hubX - coreR * 0.3), cy: String(hubY - coreR * 0.42), rx: String(coreR * 0.36), ry: String(coreR * 0.22), fill: '#FFFFFF', opacity: '0.4', filter: 'url(#soft)' }));

  // stage nodes + labels
  pts.forEach((p, i) => {
    const c = el('circle', {
      cx: String(p.x),
      cy: String(p.y),
      r: String(nodeR),
      fill: NODE_FAINT,
      opacity: '0.45',
    }) as SVGCircleElement;
    vs.appendChild(c);
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / STAGES.length;
    const lx = hubX + (R + labelSize * 1.5) * Math.cos(a);
    const ly = hubY + (R + labelSize * 1.5) * Math.sin(a);
    const cos = Math.cos(a);
    const lbl = el('text', {
      x: String(lx),
      y: String(ly),
      'text-anchor': cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle',
      'dominant-baseline': 'middle',
      class: 'v-loop-lbl',
      fill: NODE_LABEL,
      'font-size': String(labelSize),
    });
    lbl.textContent = STAGES[i];
    vs.appendChild(lbl);
    nodes.push({ name: STAGES[i], x: p.x, y: p.y, len: nodeLens[i], el: c, litAt: 0 });
  });

  // comet trail (drawn before the head so the head sits on top)
  for (let i = 0; i < TRAIL; i++) {
    const tc = el('circle', { r: '1', fill: 'url(#vgrad)', opacity: '0' }) as SVGCircleElement;
    vs.appendChild(tc);
    trail.push(tc);
  }
  // packet: soft glowing halo + bright near-white core
  packetHalo = el('circle', {
    cx: String(pts[0].x),
    cy: String(pts[0].y),
    r: String(Math.max(9, nodeR * 2.6)),
    fill: 'url(#packetGlow)',
  }) as SVGCircleElement;
  vs.appendChild(packetHalo);
  packet = el('circle', {
    cx: String(pts[0].x),
    cy: String(pts[0].y),
    r: String(Math.max(3, nodeR * 0.82)),
    fill: '#EAFCFF',
    filter: 'url(#bloom)',
  }) as SVGCircleElement;
  packet.style.willChange = 'transform';
  vs.appendChild(packet);
}

// Animate a token gliding hub↔node along the spoke.
function spawnToken(nd: LoopNode, toHub: boolean): void {
  if (!vs) return;
  const from: Pt = toHub ? { x: nd.x, y: nd.y } : { x: hubX, y: hubY };
  const to: Pt = toHub ? { x: hubX, y: hubY } : { x: nd.x, y: nd.y };
  const c = el('circle', {
    r: '3.4',
    fill: toHub ? '#FFB91E' : '#36D6D9',
    filter: 'url(#bloom)',
  }) as SVGCircleElement;
  vs.appendChild(c);
  const dur = 620;
  const s = performance.now();
  const step = (n: number): void => {
    const t = Math.min((n - s) / dur, 1);
    const e = easeInOut(t);
    c.setAttribute('cx', String(from.x + (to.x - from.x) * e));
    c.setAttribute('cy', String(from.y + (to.y - from.y) * e));
    c.setAttribute('opacity', String(1 - Math.max(0, (t - 0.7) / 0.3)));
    if (t < 1) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

function crossed(target: number, prev: number, cur: number): boolean {
  return prev <= cur ? target > prev && target <= cur : target > prev || target <= cur;
}

function lightNode(nd: LoopNode, now: number): void {
  const lit = nd.litAt ? Math.max(0, 1 - (now - nd.litAt) / 750) : 0;
  nd.el.setAttribute('r', String(nodeR + lit * 3.2));
  nd.el.setAttribute('opacity', String(0.4 + lit * 0.6));
  nd.el.setAttribute('fill', lit > 0.02 ? 'url(#vgrad)' : NODE_FAINT);
  if (lit > 0.02) nd.el.setAttribute('filter', 'url(#bloom)');
  else nd.el.removeAttribute('filter');
}

function loopTick(now: number): void {
  if (!loopPath || !packet || !totalLen) return;
  if (!startT) startT = now;
  const p = ((now - startT) % LOOP_MS) / LOOP_MS;
  const curLen = p * totalLen;

  const head = loopPath.getPointAtLength(curLen);
  packet.setAttribute('cx', String(head.x));
  packet.setAttribute('cy', String(head.y));
  if (packetHalo) {
    packetHalo.setAttribute('cx', String(head.x));
    packetHalo.setAttribute('cy', String(head.y));
  }

  for (let i = 0; i < TRAIL; i++) {
    const back = curLen - (i + 1) * totalLen * 0.012;
    const L = ((back % totalLen) + totalLen) % totalLen;
    const pt = loopPath.getPointAtLength(L);
    const f = 1 - (i + 1) / (TRAIL + 1);
    trail[i].setAttribute('cx', String(pt.x));
    trail[i].setAttribute('cy', String(pt.y));
    trail[i].setAttribute('r', String(0.6 + 2.4 * f));
    trail[i].setAttribute('opacity', String(0.5 * f));
  }

  nodes.forEach((nd, idx) => {
    if (crossed(nd.len, prevLen, curLen)) {
      nd.litAt = now;
      if (idx === WRITE_I) {
        spawnToken(nd, true);
        hubPulseAt = now;
      } else if (idx === RECALL_I) {
        spawnToken(nd, false);
        hubPulseAt = now;
        if (readout) {
          readout.innerHTML = RECALL_READOUT;
          readout.classList.add('show');
        }
        readoutHideAt = now + 2800;
      }
    }
    lightNode(nd, now);
  });

  // hub: gentle breathing + I/O pulse
  if (hubGlow) {
    const breathe = 0.16 + 0.05 * (0.5 + 0.5 * Math.sin(now / 1500));
    const pulse = hubPulseAt ? Math.max(0, 1 - (now - hubPulseAt) / 650) : 0;
    hubGlow.setAttribute('opacity', String(breathe + pulse * 0.6));
    hubGlow.setAttribute('stroke-width', String(1.25 + pulse * 1.6));
    coreEls.forEach((e) => e.setAttribute('r', String(coreBaseR * (1 + pulse * 0.14))));
  }

  if (readoutHideAt && now > readoutHideAt) {
    readout?.classList.remove('show');
    readoutHideAt = 0;
  }

  prevLen = curLen;
  rafId = requestAnimationFrame(loopTick);
}

function showStatic(): void {
  if (!nodes.length) return;
  const recall = nodes[RECALL_I];
  recall.litAt = performance.now();
  lightNode(recall, performance.now());
  spawnToken(recall, false);
  if (hubGlow) hubGlow.setAttribute('opacity', '0.4');
  if (readout) {
    readout.innerHTML = RECALL_READOUT;
    readout.classList.add('show');
  }
}

function start(): void {
  buildSpace();
  if (prefersReduce) showStatic();
  else if (W) rafId = requestAnimationFrame(loopTick);
}

start();
addEventListener('resize', start);

// ── SLIDER ──
const track = document.getElementById('strack')!;
const prev = document.getElementById('sprev') as HTMLButtonElement;
const next = document.getElementById('snext') as HTMLButtonElement;
const dotsEl = document.getElementById('sdots');
// hide dots (infinite loop has no fixed pages)
if (dotsEl) dotsEl.style.display = 'none';
// duplicate cards for seamless looping
const originals = [...track.children];
originals.forEach((c) => track.appendChild(c.cloneNode(true)));
let pos = 0; // current translateX in px
let paused = false;
function cardStep(): number {
  const first = track.children[0] as HTMLElement;
  const gap = 20;
  return first.getBoundingClientRect().width + gap;
}
function loopWidth(): number {
  return cardStep() * originals.length;
}
function tick(): void {
  if (!paused) {
    pos += 0.45; // gentle continuous drift (px per frame)
    if (pos >= loopWidth()) pos -= loopWidth();
    track.style.transform = `translateX(-${pos}px)`;
  }
  requestAnimationFrame(tick);
}
// arrows nudge by one card, wrapping
function nudge(d: number): void {
  const step = cardStep();
  pos += d * step;
  const lw = loopWidth();
  if (pos < 0) pos += lw;
  if (pos >= lw) pos -= lw;
  track.style.transition = 'transform .35s ease';
  track.style.transform = `translateX(-${pos}px)`;
  setTimeout(() => (track.style.transition = ''), 360);
}
prev.onclick = () => nudge(-1);
next.onclick = () => nudge(1);
prev.disabled = false;
next.disabled = false;
// pause on hover so people can read a card
const sview = track.parentElement!;
sview.addEventListener('mouseenter', () => (paused = true));
sview.addEventListener('mouseleave', () => (paused = false));
track.style.transition = '';
requestAnimationFrame(tick);

// ── LATENCY CHAIN PACKET: travels the chain, slowed by stretched links ──
(function () {
  const packet = document.getElementById('chainpacket');
  const chain = packet ? packet.closest('.chain') : null;
  if (!chain || !packet) return;
  const steps = [...chain.querySelectorAll<HTMLElement>('.chain-step')];
  const links = [...chain.querySelectorAll<HTMLElement>('.chain-link')];
  function travel(): void {
    steps.forEach((s) => s.classList.remove('lit'));
    packet!.style.opacity = '1';
    let i = 0;
    function toStep(): void {
      if (i >= steps.length) {
        packet!.style.opacity = '0';
        setTimeout(travel, 1400);
        return;
      }
      const step = steps[i];
      const px = step.offsetLeft + step.offsetWidth / 2 - 4;
      // stretched links take longer (latency made visible)
      const slow = i > 0 && links[i - 1] && links[i - 1].classList.contains('stretch');
      packet!.style.transition = 'left ' + (slow ? '.7s' : '.28s') + ' ' + (slow ? 'ease-in-out' : 'linear');
      packet!.style.left = px + 'px';
      step.classList.add('lit');
      setTimeout(() => {
        i++;
        toStep();
      }, slow ? 720 : 300);
    }
    toStep();
  }
  const cObs = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        if (e.isIntersecting) {
          travel();
          cObs.disconnect();
        }
      });
    },
    { threshold: 0.3 }
  );
  cObs.observe(chain.closest('.prob-card')!);
})();

// ── PERIMETER BALL: travels inward, blocked at boundary ──
(function () {
  const ball = document.getElementById('permball');
  const flash = document.getElementById('permflash');
  if (!ball || !flash) return;
  // path waypoints from cloud (outside) toward centre, STOPPING at outer boundary (x=184)
  // ball approaches but is repelled at the perimeter
  function cycle(): void {
    // reset
    ball!.setAttribute('cx', '222');
    ball!.setAttribute('cy', '70');
    ball!.setAttribute('r', '4');
    ball!.setAttribute('opacity', '1');
    ball!.setAttribute('fill', '#0F5FDC');
    flash!.setAttribute('opacity', '0');
    flash!.setAttribute('r', '0');
    const dur = 1400;
    const startX = 222,
      boundaryX = 190,
      startY = 70,
      boundaryY = 80;
    const t0 = performance.now();
    function step(now: number): void {
      const t = (now - t0) / dur;
      if (t < 1) {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
        const x = startX + (boundaryX - startX) * e;
        const y = startY + (boundaryY - startY) * e;
        ball!.setAttribute('cx', String(x));
        ball!.setAttribute('cy', String(y));
        // grow slightly as it nears boundary
        ball!.setAttribute('r', String(4 + e * 1.5));
        requestAnimationFrame(step);
      } else {
        // impact: ball stops, flash expands red, ball recoils and fades
        flash!.setAttribute('cx', '190');
        flash!.setAttribute('cy', '80');
        flash!.setAttribute('opacity', '1');
        const f0 = performance.now();
        function flashStep(fn: number): void {
          const ft = (fn - f0) / 500;
          if (ft < 1) {
            flash!.setAttribute('r', String(ft * 18));
            flash!.setAttribute('opacity', String(1 - ft));
            ball!.setAttribute('fill', '#EF4444');
            ball!.setAttribute('cx', String(190 - ft * 8)); // recoil
            ball!.setAttribute('opacity', String(1 - ft * 0.6));
            requestAnimationFrame(flashStep);
          } else {
            ball!.setAttribute('opacity', '0');
            setTimeout(cycle, 900);
          }
        }
        requestAnimationFrame(flashStep);
      }
    }
    requestAnimationFrame(step);
  }
  // only animate when scrolled into view
  const pObs = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        if (e.isIntersecting) {
          cycle();
          pObs.disconnect();
        }
      });
    },
    { threshold: 0.3 }
  );
  pObs.observe(ball.closest('.prob-card')!);
})();

// ── QUERY COUNTER ──
let qc = 47382;
const qcounter = document.getElementById('qcounter');
setInterval(() => {
  qc += 3 + Math.floor(Math.random() * 5);
  if (qcounter) qcounter.textContent = qc.toLocaleString();
}, 200);

// ── LIVE DOWNLOADS COUNTER ── starts at 8,401, +1 every 30 / 45 / 60 minutes
const dlEl = document.getElementById('dlcount');
if (dlEl) {
  let downloads = 8401;
  const fmtN = (n: number): string => n.toLocaleString();
  dlEl.textContent = fmtN(downloads);
  const scheduleTick = (): void => {
    const mins = [30, 45, 60][Math.floor(Math.random() * 3)];
    setTimeout(() => {
      downloads += 1;
      dlEl.textContent = fmtN(downloads);
      scheduleTick();
    }, mins * 60 * 1000);
  };
  scheduleTick();
}

// ── STAT COUNTERS + RECALL DOTS ──
function countUp(id: string, end: number, fmt: (v: number) => string, dur: number): void {
  const el = document.getElementById(id);
  if (!el) return;
  const t0 = performance.now();
  const run = (n: number): void => {
    const p = Math.min((n - t0) / dur, 1),
      v = Math.round(end * (1 - Math.pow(1 - p, 3)));
    el.textContent = fmt(v);
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}
const rd = document.getElementById('rdots')!;
for (let i = 0; i < 12; i++) {
  const d = document.createElement('div');
  d.className = 'rdot';
  rd.appendChild(d);
}
function fireRecall(): void {
  [...rd.children].forEach((d, i) => {
    if (i < 11) setTimeout(() => d.classList.add('hit'), 200 + i * 30);
    else setTimeout(() => d.classList.add('miss'), 200 + 11 * 30);
  });
}

// ── FRAMEWORK TABS ──
interface Snippet {
  file: string;
  desc: string;
  html: string;
  plain: string;
}
const SN: Record<string, Snippet> = {
  Python: {
    file: 'quickstart.py',
    desc: 'Use the VectorAI DB Python SDK directly for any custom agent stack. You bring the embedding model, VectorAI DB handles storage and search.',
    html: `<span class="cl"><span class="cc"># Install</span></span><span class="cl"><span class="ck">pip</span> install actian-vectorai</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">from</span> actian_vectorai <span class="ck">import</span> VectorAIClient</span><span class="cl">&nbsp;</span><span class="cl">client = VectorAIClient(host=<span class="cs">"localhost:8080"</span>)</span><span class="cl">client.create_collection(<span class="cs">"agent-memory"</span>, dim=<span class="cn">768</span>)</span><span class="cl">&nbsp;</span><span class="cl">results = client.query(</span><span class="cl">&nbsp;&nbsp;collection=<span class="cs">"agent-memory"</span>,</span><span class="cl">&nbsp;&nbsp;vector=embeddings,</span><span class="cl">&nbsp;&nbsp;top_k=<span class="cn">10</span></span><span class="cl">)</span><span class="cl">&nbsp;</span><span class="cl"><span class="cc"># 745 QPS at 10M vectors &middot; on your hardware</span></span>`,
    plain:
      'pip install actian-vectorai\n\nfrom actian_vectorai import VectorAIClient\n\nclient = VectorAIClient(host="localhost:8080")\nclient.create_collection("agent-memory", dim=768)\nresults = client.query(collection="agent-memory", vector=embeddings, top_k=10)',
  },
  JavaScript: {
    file: 'quickstart.js',
    desc: 'Use the VectorAI DB JavaScript SDK in Node or the browser. Same API surface as the Python client.',
    html: `<span class="cl"><span class="cc">// Install</span></span><span class="cl"><span class="ck">npm</span> install @actian/vectorai</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">import</span> { VectorAIClient } <span class="ck">from</span> <span class="cs">"@actian/vectorai"</span>;</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">const</span> client = <span class="ck">new</span> VectorAIClient({ host: <span class="cs">"localhost:8080"</span> });</span><span class="cl"><span class="ck">await</span> client.createCollection(<span class="cs">"agent-memory"</span>, { dim: <span class="cn">768</span> });</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">const</span> results = <span class="ck">await</span> client.query({</span><span class="cl">&nbsp;&nbsp;collection: <span class="cs">"agent-memory"</span>,</span><span class="cl">&nbsp;&nbsp;vector: embeddings,</span><span class="cl">&nbsp;&nbsp;topK: <span class="cn">10</span></span><span class="cl">});</span><span class="cl">&nbsp;</span><span class="cl"><span class="cc">// same API everywhere you deploy</span></span>`,
    plain:
      'npm install @actian/vectorai\n\nimport { VectorAIClient } from "@actian/vectorai";\n\nconst client = new VectorAIClient({ host: "localhost:8080" });\nawait client.createCollection("agent-memory", { dim: 768 });\nconst results = await client.query({ collection: "agent-memory", vector: embeddings, topK: 10 });',
  },
  LangChain: {
    file: 'langchain_memory.py',
    desc: 'Native LangChain integration. Use VectorAI DB as a persistent vector store in any retrieval chain or agent memory module.',
    html: `<span class="cl"><span class="cc"># Install</span></span><span class="cl"><span class="ck">pip</span> install actian-vectorai langchain</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">from</span> actian_vectorai.langchain <span class="ck">import</span> VectorAIStore</span><span class="cl"><span class="ck">from</span> langchain.chains <span class="ck">import</span> RetrievalQA</span><span class="cl">&nbsp;</span><span class="cl">store = VectorAIStore(</span><span class="cl">&nbsp;&nbsp;host=<span class="cs">"localhost:8080"</span>,</span><span class="cl">&nbsp;&nbsp;collection=<span class="cs">"agent-memory"</span></span><span class="cl">)</span><span class="cl">&nbsp;</span><span class="cl">qa = RetrievalQA.from_chain_type(</span><span class="cl">&nbsp;&nbsp;retriever=store.as_retriever(k=<span class="cn">10</span>)</span><span class="cl">)</span><span class="cl">&nbsp;</span><span class="cl"><span class="cc"># native integration &middot; on your hardware</span></span>`,
    plain:
      'pip install actian-vectorai langchain\n\nfrom actian_vectorai.langchain import VectorAIStore\nfrom langchain.chains import RetrievalQA\n\nstore = VectorAIStore(host="localhost:8080", collection="agent-memory")\nqa = RetrievalQA.from_chain_type(retriever=store.as_retriever(k=10))',
  },
  LlamaIndex: {
    file: 'llamaindex_rag.py',
    desc: 'Native LlamaIndex integration. Use VectorAI DB as the retrieval backend in any pipeline, on-premises or at the edge.',
    html: `<span class="cl"><span class="cc"># Install</span></span><span class="cl"><span class="ck">pip</span> install actian-vectorai llama-index</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">from</span> actian_vectorai.llamaindex <span class="ck">import</span> VectorAIVectorStore</span><span class="cl"><span class="ck">from</span> llama_index.core <span class="ck">import</span> VectorStoreIndex</span><span class="cl">&nbsp;</span><span class="cl">store = VectorAIVectorStore(</span><span class="cl">&nbsp;&nbsp;host=<span class="cs">"localhost:8080"</span>,</span><span class="cl">&nbsp;&nbsp;collection=<span class="cs">"documents"</span></span><span class="cl">)</span><span class="cl">&nbsp;</span><span class="cl">index = VectorStoreIndex.from_vector_store(store)</span><span class="cl">engine = index.as_query_engine(similarity_top_k=<span class="cn">10</span>)</span><span class="cl">&nbsp;</span><span class="cl"><span class="cc"># local RAG &middot; no cloud vector service</span></span>`,
    plain:
      'pip install actian-vectorai llama-index\n\nfrom actian_vectorai.llamaindex import VectorAIVectorStore\nfrom llama_index.core import VectorStoreIndex\n\nstore = VectorAIVectorStore(host="localhost:8080", collection="documents")\nindex = VectorStoreIndex.from_vector_store(store)\nengine = index.as_query_engine(similarity_top_k=10)',
  },
  HuggingFace: {
    file: 'huggingface_embed.py',
    desc: 'Use any Hugging Face embedding model with VectorAI DB. Bring sentence-transformers or your own fine-tuned model.',
    html: `<span class="cl"><span class="cc"># Install</span></span><span class="cl"><span class="ck">pip</span> install actian-vectorai sentence-transformers</span><span class="cl">&nbsp;</span><span class="cl"><span class="ck">from</span> actian_vectorai <span class="ck">import</span> VectorAIClient</span><span class="cl"><span class="ck">from</span> sentence_transformers <span class="ck">import</span> SentenceTransformer</span><span class="cl">&nbsp;</span><span class="cl">model = SentenceTransformer(<span class="cs">"all-MiniLM-L6-v2"</span>)</span><span class="cl">client = VectorAIClient(host=<span class="cs">"localhost:8080"</span>)</span><span class="cl">&nbsp;</span><span class="cl">vecs = model.encode(docs)</span><span class="cl">client.upsert(<span class="cs">"agent-memory"</span>, vectors=vecs)</span><span class="cl">&nbsp;</span><span class="cl"><span class="cc"># any HF model &middot; multimodal supported</span></span>`,
    plain:
      'pip install actian-vectorai sentence-transformers\n\nfrom actian_vectorai import VectorAIClient\nfrom sentence_transformers import SentenceTransformer\n\nmodel = SentenceTransformer("all-MiniLM-L6-v2")\nclient = VectorAIClient(host="localhost:8080")\nvecs = model.encode(docs)\nclient.upsert("agent-memory", vectors=vecs)',
  },
};
let currentSnippet: Snippet = SN.Python;
const codeBody = document.getElementById('codebody');
const codeFile = document.getElementById('codefile');
const gsDesc = document.getElementById('gsdesc');
function setFw(name: string): void {
  if (!SN[name] || !codeBody) return;
  currentSnippet = SN[name];
  codeBody.classList.add('fading');
  setTimeout(() => {
    codeBody.innerHTML = currentSnippet.html;
    if (codeFile) codeFile.textContent = currentSnippet.file;
    if (gsDesc) gsDesc.textContent = currentSnippet.desc;
    codeBody.classList.remove('fading');
  }, 150);
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.fw === name));
  document.querySelectorAll<HTMLElement>('.fw-logo').forEach((l) => l.classList.toggle('active', l.dataset.fw === name));
}
document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
  t.onclick = () => {
    if (t.dataset.fw) setFw(t.dataset.fw);
  };
});
if (codeBody) codeBody.innerHTML = SN.Python.html;
if (gsDesc) gsDesc.textContent = SN.Python.desc;

// ── FAQ ──
function toggleFaq(item: Element): void {
  const open = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
  if (!open) item.classList.add('open');
}
document.querySelectorAll<HTMLElement>('.faq-item').forEach((item) => {
  item.addEventListener('click', () => toggleFaq(item));
});

// ── SCROLL OBSERVER ──
const io = new IntersectionObserver(
  (es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('on');
      if (e.target.id === 'statsec') {
        countUp('n1', 745, (v) => v + ' QPS', 900);
        setTimeout(() => countUp('n2', 99, (v) => v + '%', 900), 100);
        setTimeout(() => countUp('n3', 13, (v) => v + 'ms', 900), 200);
        fireRecall();
      }
      if (e.target.querySelector('.cmp-row')) {
        e.target.querySelectorAll('.cmp-row').forEach((r, i) => setTimeout(() => r.classList.add('on'), i * 50));
      }
      io.unobserve(e.target);
    });
  },
  { threshold: 0.1 }
);
document.querySelectorAll('.fi').forEach((el) => io.observe(el));
