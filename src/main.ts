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

// ── SEMANTIC MEMORY CLUSTER VISUALISATION ──
// Illustrates how VectorAI DB organises agent memory into semantic clusters and
// resolves a query to its nearest matches. Loops through clusters; honours reduced motion.
interface MemPoint {
  x: number;
  y: number;
  el: SVGCircleElement | null;
  base: number; // baseline opacity
}
interface Cluster {
  cx: number;
  cy: number;
  color: string;
  readout: string;
  points: MemPoint[];
}
// Relative cluster layout — positions are fractions of width/height so it scales.
const CLUSTER_DEFS = [
  { label: 'session memory', fx: 0.3, fy: 0.3, color: '#36D6D9', readout: '12ms &middot; 5 results &middot; 99.2% recall' },
  { label: 'tool calls', fx: 0.71, fy: 0.33, color: '#3C91FF', readout: '13ms &middot; 5 results &middot; 99.1% recall' },
  { label: 'doc context', fx: 0.42, fy: 0.72, color: '#FFB91E', readout: '14ms &middot; 5 results &middot; 98.9% recall' },
];
const vs = document.getElementById('vspace') as SVGSVGElement | null;
const readout = document.getElementById('vreadout');
const prefersReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let W = 0,
  H = 0,
  clusters: Cluster[] = [];
let qEls: SVGElement[] = [];

function buildSpace(): void {
  if (!vs) return;
  vs.innerHTML = '';
  clusters = [];
  qEls = [];
  const r = vs.getBoundingClientRect();
  W = r.width;
  H = r.height;
  if (!W || !H) return;
  vs.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML =
    '<linearGradient id="vgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#36D6D9"/><stop offset=".4" stop-color="#3C91FF"/><stop offset="1" stop-color="#0F5FDC"/></linearGradient><filter id="vglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  vs.appendChild(defs);

  const small = W < 380;
  const spread = Math.min(W, H) * 0.12;
  const count = small ? 6 : 8;
  const labelSize = Math.max(9, Math.round(W * 0.018));

  CLUSTER_DEFS.forEach((def) => {
    const ccx = W * def.fx;
    const ccy = H * def.fy;
    const points: MemPoint[] = [];
    // faint hull ring so the cluster reads as a group at rest
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', String(ccx));
    ring.setAttribute('cy', String(ccy));
    ring.setAttribute('r', String(spread * 1.5));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', def.color);
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '.12');
    vs.appendChild(ring);
    // scattered embedding points (uniform-ish within the disc)
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * spread;
      const x = ccx + Math.cos(ang) * rad;
      const y = ccy + Math.sin(ang) * rad;
      const base = 0.34 + Math.random() * 0.16;
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', '3');
      c.setAttribute('fill', def.color);
      c.setAttribute('opacity', String(base));
      vs.appendChild(c);
      points.push({ x, y, el: c, base });
    }
    // cluster label
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', String(ccx));
    t.setAttribute('y', String(ccy + spread * 1.5 + labelSize + 4));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'v-cluster-lbl');
    t.setAttribute('fill', def.color);
    t.setAttribute('font-size', String(labelSize));
    t.textContent = def.label;
    vs.appendChild(t);

    clusters.push({ cx: ccx, cy: ccy, color: def.color, readout: def.readout, points });
  });
}

function clearQ(): void {
  qEls.forEach((e) => e.remove());
  qEls = [];
  clusters.forEach((cl) =>
    cl.points.forEach((p) => {
      p.el!.setAttribute('opacity', String(p.base));
      p.el!.removeAttribute('filter');
      p.el!.setAttribute('r', '3');
      p.el!.setAttribute('fill', cl.color);
    })
  );
}

// Drop a query vector into a cluster and light up its k nearest matches.
function highlightMatches(cl: Cluster, animate: boolean): void {
  const k = Math.min(5, cl.points.length);
  const nearest = [...cl.points]
    .sort((a, b) => Math.hypot(a.x - cl.cx, a.y - cl.cy) - Math.hypot(b.x - cl.cx, b.y - cl.cy))
    .slice(0, k);

  const q = document.createElementNS(svgNS, 'circle');
  q.setAttribute('cx', String(cl.cx));
  q.setAttribute('cy', String(cl.cy));
  q.setAttribute('r', '5');
  q.setAttribute('fill', 'url(#vgrad)');
  q.setAttribute('filter', 'url(#vglow)');
  vs!.appendChild(q);
  qEls.push(q);

  nearest.forEach((p, i) => {
    const light = (): void => {
      p.el!.setAttribute('fill', 'url(#vgrad)');
      p.el!.setAttribute('opacity', '1');
      p.el!.setAttribute('r', '4.5');
      p.el!.setAttribute('filter', 'url(#vglow)');
      const l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', String(cl.cx));
      l.setAttribute('y1', String(cl.cy));
      l.setAttribute('x2', String(p.x));
      l.setAttribute('y2', String(p.y));
      l.setAttribute('stroke', 'url(#vgrad)');
      l.setAttribute('stroke-width', '1.5');
      l.setAttribute('opacity', animate ? '0' : '.55');
      vs!.insertBefore(l, vs!.firstChild!.nextSibling);
      qEls.push(l);
      if (animate) {
        requestAnimationFrame(() => {
          l.style.transition = 'opacity .3s';
          l.setAttribute('opacity', '.55');
        });
      }
    };
    if (animate) setTimeout(light, 120 + i * 70);
    else light();
  });
}

function showStatic(): void {
  if (!clusters.length) return;
  highlightMatches(clusters[0], false);
  if (readout) {
    readout.innerHTML = clusters[0].readout;
    readout.classList.add('show');
  }
}

let cursor = 0;
function runQuery(): void {
  clearQ();
  readout?.classList.remove('show');
  if (!W || !clusters.length) return;
  const cl = clusters[cursor % clusters.length];
  cursor++;
  highlightMatches(cl, true);
  if (readout) readout.innerHTML = cl.readout;
  setTimeout(() => readout?.classList.add('show'), 120 + 5 * 70 + 150);
  setTimeout(() => clearQ(), 3400);
}

buildSpace();
if (prefersReduce) {
  showStatic();
} else {
  runQuery();
  setInterval(runQuery, 4000);
}
addEventListener('resize', () => {
  buildSpace();
  if (prefersReduce) showStatic();
});

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
