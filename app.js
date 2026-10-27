// Déjà Vu : swipe vu / pas vu / à voir, notes de 1 à 4, et une pile qui se réordonne selon les réponses.
(() => {
  const C = window.CATALOG;
  const N = C.names;
  const BY_ID = Object.fromEntries(C.items.map((it) => [it.id, it]));
  const IMG = 'https://upload.wikimedia.org/wikipedia/';
  // ?test : un stockage à part, pour tester sans toucher aux vraies réponses.
  const TEST = new URLSearchParams(location.search).has('test');
  const STORE = TEST ? 'dejavu.test' : 'dejavu.v1';

  const KINDS = [['all', 'Films et séries'], ['film', 'Films'], ['serie', 'Séries']];
  const PERIODS = [['all', 'Toutes époques', 0, 9999], ['80', '1983-89', 1983, 1989], ['90', 'Années 90', 1990, 1999],
    ['00', 'Années 2000', 2000, 2009], ['10', 'Années 2010', 2010, 2019], ['20', 'Années 2020', 2020, 2029]];
  const STAR_LABELS = ['', 'Bof', 'Bien', 'Très bien', 'Coup de cœur'];

  // Poids des liens : un réalisateur ou une saga en disent plus long qu'un acteur ou un genre.
  const W = { d: 1.2, s: 1.6, a: 0.35, g: 0.08 };
  const SAGA_MIN = 3, SAGA_MAX = 15; // au-delà, c'est une collection (Disney, Pixar…), pas une saga qu'on voit en entier

  const SAGA = {};
  for (const it of C.items) for (const s of it.s) (SAGA[s] ??= []).push(it.id);
  for (const s in SAGA) SAGA[s].sort((a, b) => BY_ID[a].y - BY_ID[b].y);

  // Deux sagas presque identiques (« James Bond » et « James Bond produit par EON ») : on garde la plus grande.
  // Toy Story reste à part de Pixar : la taille doit être proche, pas seulement l'inclusion.
  const bySize = Object.keys(SAGA).sort((a, b) => SAGA[b].length - SAGA[a].length);
  for (const [i, a] of bySize.entries()) {
    if (!SAGA[a]) continue;
    const inA = new Set(SAGA[a]);
    for (const b of bySize.slice(i + 1)) {
      if (SAGA[b] && SAGA[b].length >= 0.7 * SAGA[a].length && SAGA[b].filter((id) => inA.has(id)).length >= 0.8 * SAGA[b].length) delete SAGA[b];
    }
  }
  // Les listes de Wikidata (« list of Illumination films », « BBC's 100 Greatest… ») ne sont pas des sagas.
  for (const s in SAGA) if (/^list(e)?\b|greatest|feature films|productions\b/i.test(N[s] || '')) delete SAGA[s];
  for (const it of C.items) it.s = it.s.filter((s) => SAGA[s]);

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const stars = (r) => '★'.repeat(r) + '☆'.repeat(4 - r);

  // ---------- État ----------

  const fresh = () => ({ kind: 'all', period: 'all', answers: {}, sagas: {}, history: [] });
  let st = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) return { ...fresh(), ...JSON.parse(raw) };
    } catch {}
    return fresh();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch {}
  }

  // ---------- Déductions ----------

  // Ce qu'une réponse dit des titres liés : vu et adoré pousse fort, pas vu freine.
  function weightOf(a) {
    if (a.v === 'seen') return a.r ? 0.5 * a.r : 1;
    if (a.v === 'unseen') return -0.6;
    if (a.v === 'unsure') return 0; // un doute ne dit rien des titres liés
    return 0.3;
  }

  function affinity() {
    const aff = {};
    for (const [id, a] of Object.entries(st.answers)) {
      const it = BY_ID[id];
      if (!it) continue;
      const w = weightOf(a);
      for (const k of ['d', 's', 'a', 'g']) for (const f of it[k]) {
        // Clé par rôle : Eric Stoltz acteur de Pulp Fiction ne fait pas remonter les épisodes qu'il a réalisés.
        const e = (aff[k + f] ??= { v: 0, src: null, best: 0 });
        e.v += k === 's' && w < 0 ? w * 2.5 : w; // pas vu le premier : les suites ont peu de chances
        if (w > e.best) { e.best = w; e.src = id; }
      }
    }
    return aff;
  }

  function scoreOf(it, aff) {
    let boost = 0, why = null, whyVal = 0.45;
    for (const k of ['d', 's', 'a', 'g']) {
      let sub = 0;
      for (const f of it[k]) {
        const e = aff[k + f];
        if (!e) continue;
        const kw = k === 's' && SAGA[f].length > SAGA_MAX ? 0.4 : W[k];
        const c = kw * clamp(e.v, -3, 3);
        sub += c;
        if (c > whyVal && e.src && e.src !== it.id) { whyVal = c; why = { k, f, src: e.src }; }
      }
      if (k === 'a') sub = clamp(sub, -1.5, 2);
      if (k === 'g') sub = clamp(sub, -0.8, 0.8);
      boost += sub;
    }
    return { score: Math.log(it.l) + (it.fr ? 0.5 : 0) + boost, boost, why };
  }

  function ranked(n) {
    const aff = affinity();
    const [, , lo, hi] = PERIODS.find((p) => p[0] === st.period);
    const top = [];
    for (const it of C.items) {
      if (st.answers[it.id] || it.y < lo || it.y > hi || (st.kind !== 'all' && it.k !== st.kind)) continue;
      const s = scoreOf(it, aff);
      if (top.length < n || s.score > top[top.length - 1].score) {
        top.push({ it, ...s });
        top.sort((a, b) => b.score - a.score);
        if (top.length > n) top.pop();
      }
    }
    return top;
  }

  // Une saga encore jamais abordée se pose d'un coup, avant son premier film.
  function sagaFor(it) {
    return it.s.find((s) => SAGA[s].length >= SAGA_MIN && SAGA[s].length <= SAGA_MAX && !st.sagas[s] && !SAGA[s].some((id) => st.answers[id]));
  }

  function whyText(w) {
    const src = esc(BY_ID[w.src].t), name = esc(N[w.f]);
    if (w.k === 'd') return `🎬 De <b>${name}</b>, comme ${src}`;
    if (w.k === 's') return `🎞️ ${SAGA[w.f].length > SAGA_MAX ? 'Collection' : 'Saga'} <b>${name}</b>, comme ${src}`;
    if (w.k === 'a') return `🎭 Avec <b>${name}</b>, comme dans ${src}`;
    return `🏷️ <b>${name}</b>, comme ${src}`;
  }

  // ---------- Réponses ----------

  function answer(id, v) {
    st.answers[id] = { v, r: 0, t: Date.now() };
    st.history.push({ id });
    save();
  }

  function answerSaga(sid, choice) {
    const ids = choice === 'some' ? [] : SAGA[sid].filter((id) => !st.answers[id]);
    for (const id of ids) st.answers[id] = { v: choice === 'all' ? 'seen' : 'unseen', r: 0, t: Date.now(), via: 'saga' };
    st.sagas[sid] = choice;
    st.history.push({ saga: sid, ids });
    save();
    if (choice === 'all') toast(`${ids.length} films marqués vus, note-les dans « Ma liste »`);
    render();
  }

  function undo() {
    const h = st.history.pop();
    if (!h) return toast('Rien à annuler');
    if (h.saga) {
      delete st.sagas[h.saga];
      h.ids.forEach((id) => delete st.answers[id]);
    } else delete st.answers[h.id];
    hideStars();
    save();
    render();
    toast('Annulé');
  }

  // ---------- Pile de cartes ----------

  let busy = false;

  function cardHTML(it, why) {
    const by = it.d.slice(0, 2).map((id) => N[id]).filter(Boolean).join(', ');
    const hue = parseInt(it.id.slice(1), 10) % 360;
    return `
      <div class="fallback" style="background:linear-gradient(150deg,hsl(${hue} 45% 28%),hsl(${(hue + 60) % 360} 40% 12%))">${esc(it.t)}</div>
      ${it.img ? `<img class="poster" src="${IMG + it.img}" alt="" draggable="false" onerror="this.remove()">` : ''}
      <div class="shade"></div>
      ${why ? `<div class="why">${whyText(why)}</div>` : ''}
      <div class="stamp yes">VU</div><div class="stamp no">PAS VU</div><div class="stamp want">À VOIR</div><div class="stamp unsure">PAS SÛR</div>
      <div class="info">
        <div class="meta">${it.k === 'film' ? 'Film' : 'Série'} · ${it.y}${it.fr ? ' · 🇫🇷' : ''}</div>
        <h2>${esc(it.t)}</h2>
        ${it.o ? `<div class="orig">${esc(it.o)}</div>` : ''}
        ${by ? `<div class="by">${it.k === 'film' ? 'Réalisé par' : 'Créée par'} ${esc(by)}</div>` : ''}
        ${it.desc && !(by && it.desc.includes(by.split(', ')[0])) ? `<div class="desc">${esc(it.desc)}</div>` : ''}
      </div>`;
  }

  function sagaHTML(sid) {
    const list = SAGA[sid].map((id) => `<li>${esc(BY_ID[id].t)} <span>${BY_ID[id].y}</span></li>`).join('');
    return `
      <div class="meta">Saga · ${SAGA[sid].length} titres</div>
      <h2>${esc(N[sid])}</h2>
      <ol>${list}</ol>
      <div class="choices">
        <button class="none" data-c="none">✕ Aucun</button>
        <button data-c="some">🤔 Quelques-uns</button>
        <button class="all" data-c="all">✓ Tous vus</button>
      </div>`;
  }

  function render() {
    renderCounter();
    const deck = $('deck');
    deck.innerHTML = '';
    const [first, second] = ranked(2);
    if (!first) {
      deck.innerHTML = `<div class="empty"><p>Plus rien à swiper dans cette sélection.</p><p>Change d'époque ou de type.</p></div>`;
      return;
    }
    if (second) {
      const b = document.createElement('div');
      b.className = 'card behind';
      b.innerHTML = cardHTML(second.it);
      deck.append(b);
    }
    const sid = sagaFor(first.it);
    const el = document.createElement('div');
    if (sid) {
      el.className = 'card saga';
      el.dataset.saga = sid;
      el.innerHTML = sagaHTML(sid);
      el.querySelectorAll('[data-c]').forEach((btn) => (btn.onclick = () => answerSaga(sid, btn.dataset.c)));
    } else {
      el.className = 'card';
      el.dataset.id = first.it.id;
      el.innerHTML = cardHTML(first.it, first.why);
      drag(el);
    }
    deck.append(el);
  }

  function renderCounter() {
    const all = Object.values(st.answers);
    const seen = all.filter((a) => a.v === 'seen').length;
    $('counter').textContent = `${seen} vus · ${all.length} réponses`;
  }

  function stamps(el, dx, dy) {
    el.querySelector('.stamp.yes').style.opacity = clamp(dx / 100, 0, 1);
    el.querySelector('.stamp.no').style.opacity = clamp(-dx / 100, 0, 1);
    el.querySelector('.stamp.want').style.opacity = Math.abs(dx) < 90 ? clamp(-dy / 110, 0, 1) : 0;
    el.querySelector('.stamp.unsure').style.opacity = Math.abs(dx) < 90 ? clamp(dy / 110, 0, 1) : 0;
  }

  function drag(el) {
    let x0 = 0, y0 = 0, dx = 0, dy = 0, on = false;
    el.addEventListener('pointerdown', (e) => {
      if (busy) return;
      on = true; x0 = e.clientX; y0 = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.remove('back');
    });
    el.addEventListener('pointermove', (e) => {
      if (!on) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 18}deg)`;
      stamps(el, dx, dy);
    });
    const end = () => {
      if (!on) return;
      on = false;
      const v = dx > 100 ? 'seen' : dx < -100 ? 'unseen'
        : Math.abs(dx) < 90 && dy < -110 ? 'want' : Math.abs(dx) < 90 && dy > 110 ? 'unsure' : null;
      if (v) fly(el, v);
      else { el.classList.add('back'); el.style.transform = ''; stamps(el, 0, 0); }
      dx = dy = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function fly(el, v) {
    busy = true;
    hideStars();
    const tx = v === 'seen' ? innerWidth * 1.3 : v === 'unseen' ? -innerWidth * 1.3 : 0;
    const ty = v === 'want' ? -innerHeight : v === 'unsure' ? innerHeight : 40;
    stamps(el, v === 'seen' ? 100 : v === 'unseen' ? -100 : 0, v === 'want' ? -110 : v === 'unsure' ? 110 : 0);
    el.classList.add('fly');
    el.style.transform = `translate(${tx}px,${ty}px) rotate(${tx / 25}deg)`;
    el.style.opacity = 0;
    const id = el.dataset.id;
    setTimeout(() => {
      answer(id, v);
      busy = false;
      render();
      if (v === 'seen') showStars(id);
    }, 260);
  }

  // Sur une carte saga : ✓ tous vus, ✕ aucun, 🤔 quelques-uns.
  const SAGA_ACT = { seen: 'all', unseen: 'none', unsure: 'some' };

  function act(v) {
    const el = $('deck').querySelector('.card:not(.behind)');
    if (!el || busy) return;
    if (el.dataset.saga) SAGA_ACT[v] && answerSaga(el.dataset.saga, SAGA_ACT[v]);
    else fly(el, v);
  }

  // ---------- Notation ----------

  let rating = null;

  function showStars(id) {
    rating = id;
    $('stars-title').textContent = BY_ID[id].t;
    $('stars').innerHTML = [1, 2, 3, 4].map((n) => `<button data-n="${n}" title="${STAR_LABELS[n]}">★</button>`).join('');
    $('stars').querySelectorAll('button').forEach((b) => {
      b.onclick = () => rate(+b.dataset.n);
      b.onpointerenter = () => highlight(+b.dataset.n);
    });
    $('stars').onpointerleave = () => highlight(0);
    highlight(0);
    $('stars-sheet').hidden = false;
  }

  function highlight(n) {
    $('stars').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n <= n));
    $('stars-hint').textContent = n ? STAR_LABELS[n] : 'Tu as aimé ?';
  }

  function rate(n) {
    if (!rating || !st.answers[rating]) return;
    st.answers[rating].r = n;
    save();
    highlight(n);
    setTimeout(hideStars, 250);
    render(); // la note change les déductions
  }

  function hideStars() {
    rating = null;
    $('stars-sheet').hidden = true;
  }

  // ---------- Ma liste ----------

  function rowHTML(it) {
    const a = st.answers[it.id];
    const thumb = it.img ? `<img src="${IMG + it.img}" alt="" loading="lazy" onerror="this.className='ph';this.removeAttribute('src')">` : '<div class="ph"></div>';
    const by = it.d.slice(0, 1).map((id) => N[id]).join('');
    const on = (v) => (a?.v === v ? ' on' : '');
    return `<div class="row" data-id="${it.id}">${thumb}
      <div class="txt"><div>${esc(it.t)}</div><small>${it.y} · ${it.k === 'film' ? 'film' : 'série'}${by ? ' · ' + esc(by) : ''}</small></div>
      ${a?.v === 'seen' ? `<button class="rate" data-act="rate" title="Changer la note">${stars(a.r)}</button>` : ''}
      <div class="mini">
        <button class="yes${on('seen')}" data-act="seen" title="Vu">✓</button>
        <button class="no${on('unseen')}" data-act="unseen" title="Pas vu">✕</button>
        <button class="unsure${on('unsure')}" data-act="unsure" title="Pas sûr">🤔</button>
        <button class="want${on('want')}" data-act="want" title="À voir">☆</button>
      </div></div>`;
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    let html = '';
    if (q) {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const nq = norm(q);
      const hits = C.items.filter((it) => norm(it.t).includes(nq) || norm(it.o).includes(nq) || it.d.some((d) => norm(N[d]).includes(nq))).slice(0, 60);
      html = hits.length ? hits.map(rowHTML).join('') : '<p class="empty-txt">Aucun titre du catalogue ne correspond.</p>';
    } else {
      const items = Object.entries(st.answers).map(([id, a]) => ({ it: BY_ID[id], a })).filter((x) => x.it);
      const groups = [
        ['★★★★ Coup de cœur', (a) => a.v === 'seen' && a.r === 4], ['★★★ Très bien', (a) => a.v === 'seen' && a.r === 3],
        ['★★ Bien', (a) => a.v === 'seen' && a.r === 2], ['★ Bof', (a) => a.v === 'seen' && a.r === 1],
        ['Vus, sans note', (a) => a.v === 'seen' && !a.r], ['🤔 Pas sûr', (a) => a.v === 'unsure'], ['À voir', (a) => a.v === 'want'],
      ];
      for (const [label, test] of groups) {
        const g = items.filter((x) => test(x.a)).sort((x, y) => y.a.t - x.a.t);
        if (g.length) html += `<h3>${label} (${g.length})</h3>` + g.map((x) => rowHTML(x.it)).join('');
      }
      if (!html) html = '<p class="empty-txt">Rien encore. Swipe quelques titres, ou cherche un titre ci-dessus.</p>';
    }
    $('list').innerHTML = html;
  }

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.row').dataset.id;
    const act = btn.dataset.act;
    const a = st.answers[id];
    if (act === 'rate') a.r = (a.r + 1) % 5;
    else if (a?.v === act) delete st.answers[id];
    else st.answers[id] = { v: act, r: 0, t: Date.now() };
    save();
    renderList();
    renderCounter();
  });
  $('search').addEventListener('input', renderList);

  // ---------- Bilan ----------

  function renderStats() {
    const ans = Object.entries(st.answers).map(([id, a]) => ({ it: BY_ID[id], a })).filter((x) => x.it);
    const seen = ans.filter((x) => x.a.v === 'seen');
    const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
    let html = '<div class="grid">'
      + tile(seen.length, 'vus')
      + tile(ans.filter((x) => x.a.v === 'unseen').length, 'pas vus')
      + tile(ans.filter((x) => x.a.v === 'unsure').length, 'pas sûr')
      + tile(ans.filter((x) => x.a.v === 'want').length, 'à voir')
      + tile(Math.round((100 * ans.length) / C.items.length) + ' %', `du catalogue parcouru (${C.items.length} titres)`).replace('tile', 'tile wide')
      + '</div>';

    html += '<h3>Part de vus, par époque</h3><div class="bars">';
    for (const [key, label, lo, hi] of PERIODS.slice(1)) {
      const p = ans.filter((x) => x.it.y >= lo && x.it.y <= hi && (x.a.v === 'seen' || x.a.v === 'unseen'));
      const s = p.filter((x) => x.a.v === 'seen').length;
      const pct = p.length ? Math.round((100 * s) / p.length) : 0;
      html += `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span>${p.length ? pct + ' %' : '·'}</span></div>`;
    }
    html += '</div>';

    const dirs = {};
    for (const x of seen) for (const d of x.it.d) dirs[d] = (dirs[d] || 0) + 1;
    const topDirs = Object.entries(dirs).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (topDirs.length) html += '<h3>Réalisateurs les plus vus</h3>' + topDirs.map(([d, n]) => `<div class="bar"><span>${esc(N[d])}</span><div class="track"><div class="fill" style="width:${Math.min(100, n * 12)}%"></div></div><span>${n}</span></div>`).join('');

    html += `<p class="note">Catalogue Wikidata du ${C.built}. Tes réponses sont enregistrées dans ce navigateur : sauvegarde-les en JSON de temps en temps.</p>`;
    $('stats').innerHTML = html;
  }

  function exportMarkdown() {
    const ans = Object.entries(st.answers).map(([id, a]) => ({ it: BY_ID[id], a })).filter((x) => x.it);
    const line = (x) => `- ${x.it.t} (${x.it.y})${x.it.d.length ? ', ' + x.it.d.slice(0, 2).map((d) => N[d]).join(', ') : ''} · ${x.it.k === 'film' ? 'film' : 'série'}`;
    const today = new Date().toISOString().slice(0, 10);
    let md = `---\ntype: liste\nupdated: ${today}\ntags: [deja-vu]\n---\n\n# Déjà Vu, ma liste\n\n`;
    md += `| Champ | Valeur |\n|---|---|\n| Vus | ${ans.filter((x) => x.a.v === 'seen').length} |\n| Réponses | ${ans.length} |\n| Export | ${today} |\n`;
    for (const r of [4, 3, 2, 1, 0]) {
      const g = ans.filter((x) => x.a.v === 'seen' && x.a.r === r).sort((a, b) => a.it.y - b.it.y);
      if (g.length) md += `\n## ${r ? stars(r) + ' ' + STAR_LABELS[r] : 'Vus, sans note'}\n\n` + g.map(line).join('\n') + '\n';
    }
    for (const [v, title] of [['unsure', 'Pas sûr'], ['want', 'À voir']]) {
      const g = ans.filter((x) => x.a.v === v);
      if (g.length) md += `\n## ${title}\n\n` + g.map(line).join('\n') + '\n';
    }
    return md;
  }

  // Format d'import de Letterboxd (letterboxd.com/about/importing-data) : films seulement, les séries n'y ont pas leur place.
  // Les identifiants IMDb et TMDB donnent une correspondance exacte ; titre, année et réalisateurs servent de secours.
  const LB_RATING = ['', 2, 3, 4, 5]; // 1★ Bof → 2/5 … 4★ Coup de cœur → 5/5

  function exportLetterboxd(v) {
    const films = Object.entries(st.answers)
      .filter(([id, a]) => a.v === v && BY_ID[id]?.k === 'film')
      .map(([id, a]) => ({ it: BY_ID[id], a }));
    if (!films.length) return toast(v === 'seen' ? 'Aucun film vu à exporter' : 'Aucun film à voir à exporter');
    const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const rows = films.map(({ it, a }) => [it.im, it.tm, it.o || it.t, it.y, it.d.map((d) => N[d]).join(', '), v === 'seen' ? LB_RATING[a.r] : ''].map(cell).join(','));
    const csv = ['imdbID,tmdbID,Title,Year,Directors,Rating', ...rows].join('\n');
    download(`deja-vu-letterboxd-${v === 'seen' ? 'vus' : 'a-voir'}.csv`, csv, 'text/csv;charset=utf-8');
    const series = Object.entries(st.answers).filter(([id, a]) => a.v === v && BY_ID[id]?.k === 'serie').length;
    const s = (n) => (n > 1 ? 's' : '');
    toast(`${films.length} film${s(films.length)} exporté${s(films.length)}${series ? `, ${series} série${s(series)} laissée${s(series)} de côté` : ''}`);
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('btn-export-md').onclick = async () => {
    const md = exportMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      toast('Liste copiée, à coller dans une note Obsidian');
    } catch {
      download('Deja Vu - ma liste.md', md, 'text/markdown');
    }
  };
  $('btn-lb-seen').onclick = () => exportLetterboxd('seen');
  $('btn-lb-want').onclick = () => exportLetterboxd('want');
  $('btn-export-json').onclick = () =>
    download(`deja-vu-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'deja-vu', version: 1, ...st }), 'application/json');
  $('import-json').onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.app !== 'deja-vu') throw new Error();
      st = { ...fresh(), ...data };
      delete st.app; delete st.version;
      save();
      toast(`${Object.keys(st.answers).length} réponses restaurées`);
      renderStats();
      render();
    } catch {
      toast('Fichier non reconnu');
    }
  };
  $('btn-reset').onclick = () => {
    if (!confirm('Effacer toutes tes réponses ? Pense à sauvegarder avant.')) return;
    st = fresh();
    save();
    render();
    renderStats();
  };

  // ---------- Navigation, filtres, clavier ----------

  function chips(el, list, key) {
    el.innerHTML = list.map(([v, label]) => `<button data-v="${v}" class="${st[key] === v ? 'on' : ''}">${label}</button>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      st[key] = b.dataset.v;
      save();
      chips(el, list, key);
      hideStars();
      render();
    };
  }

  $('tabs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
    hideStars();
    if (b.dataset.view === 'list') renderList();
    if (b.dataset.view === 'stats') renderStats();
    if (b.dataset.view === 'swipe') render();
  };

  $('btn-yes').onclick = () => act('seen');
  $('btn-no').onclick = () => act('unseen');
  $('btn-want').onclick = () => act('want');
  $('btn-unsure').onclick = () => act('unsure');
  $('btn-undo').onclick = undo;
  $('stars-skip').onclick = hideStars;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || !$('view-swipe').classList.contains('active')) return;
    if (rating && /^[1-4]$/.test(e.key)) return rate(+e.key);
    if (e.key === 'ArrowRight') act('seen');
    else if (e.key === 'ArrowLeft') act('unseen');
    else if (e.key === 'ArrowUp') act('want');
    else if (e.key === 'ArrowDown') act('unsure');
    else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) undo();
    else return;
    e.preventDefault();
  });

  let toastTimer;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), 2200);
  }

  if (TEST) document.querySelector('.top h1').insertAdjacentHTML('beforeend', ' <small style="color:var(--no);font-size:12px">TEST</small>');
  chips($('kind-chips'), KINDS, 'kind');
  chips($('period-chips'), PERIODS, 'period');
  render();
})();
