// Construit le catalogue de Déjà Vu depuis Wikidata (titres, liens) et Wikipédia EN (affiches).
// Usage : node scripts/build-catalog.js [--films 120] [--series 30] [--from 1983] [--to 2026]
// Sortie : data/catalog.js (window.CATALOG = {...}), lisible sans serveur.

const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const FROM = +(args.from || 1983);
const TO = +(args.to || 2026);
const FILMS_PER_YEAR = +(args.films || 120);
const SERIES_PER_YEAR = +(args.series || 30);
const UA = 'DejaVu/0.1 (projet personnel, catalogue films et series)';
const OUT = path.join(__dirname, '..', 'data', 'catalog.js');
const CACHE = path.join(__dirname, '..', 'data', '.cache');

const FILM_TYPES = 'wd:Q11424 wd:Q202866';                           // film, film d'animation
const SERIES_TYPES = 'wd:Q5398426 wd:Q581714 wd:Q1259759 wd:Q526877'; // série, série animée, mini-série, web-série
const PROPS = { P57: 'd', P170: 'd', P161: 'a', P179: 's', P136: 'g', P495: 'c' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exécute fn sur chaque élément, n à la fois (Wikidata tolère 5 requêtes simultanées par IP).
async function pool(list, n, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < list.length) {
      const k = next++;
      out[k] = await fn(list[k], k);
    }
  }));
  return out;
}
fs.mkdirSync(CACHE, { recursive: true });

// Requête SPARQL avec cache disque (relancer le script ne refait pas les requêtes) et reprise sur erreur.
async function sparql(query, cacheKey) {
  const file = cacheKey && path.join(CACHE, cacheKey + '.json');
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      const rows = (await res.json()).results.bindings.map((b) =>
        Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.replace('http://www.wikidata.org/entity/', '')]))
      );
      if (file) fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(300);
      return rows;
    } catch (e) {
      console.warn(`  ! ${cacheKey} essai ${attempt} : ${e.message}`);
      await sleep(5000 * attempt);
    }
  }
  throw new Error('Wikidata ne répond pas pour ' + cacheKey);
}

function candidatesQuery(types, dateProp, year, limit) {
  return `SELECT DISTINCT ?item ?links WHERE {
    VALUES ?type { ${types} }
    ?item wdt:P31 ?type ; wdt:${dateProp} ?d ; wikibase:sitelinks ?links .
    FILTER(?d >= "${year}-01-01T00:00:00Z"^^xsd:dateTime && ?d < "${year + 1}-01-01T00:00:00Z"^^xsd:dateTime)
    FILTER(?links > 8)
  } ORDER BY DESC(?links) LIMIT ${limit}`;
}

const values = (ids) => ids.map((id) => 'wd:' + id).join(' ');

const infoQuery = (ids) => `SELECT ?item ?fr ?en ?desc ?enwiki ?d WHERE {
  VALUES ?item { ${values(ids)} }
  OPTIONAL { ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "fr") }
  OPTIONAL { ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }
  OPTIONAL { ?item wdt:P577|wdt:P580 ?d }
}`;

const relQuery = (ids) => `SELECT ?item ?p ?v ?vLabel WHERE {
  VALUES ?item { ${values(ids)} }
  VALUES ?p { ${Object.keys(PROPS).map((p) => 'wdt:' + p).join(' ')} }
  ?item ?p ?v .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}`;

// Affiches : image principale de l'article Wikipédia anglais (pilicense=any pour inclure les affiches non libres).
async function posters(enTitles) {
  const out = {};
  for (let i = 0; i < enTitles.length; i += 50) {
    const batch = enTitles.slice(i, i + 50);
    const key = require('crypto').createHash('md5').update(batch.join('|')).digest('hex').slice(0, 12);
    const file = path.join(CACHE, `img-${key}.json`);
    let data;
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
        action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '400', pilicense: 'any',
        redirects: '1', format: 'json', formatversion: '2', titles: batch.join('|'),
      });
      // Wikipédia limite le débit : on ralentit et on réessaie plutôt que de planter.
      for (let attempt = 1; !data; attempt++) {
        try {
          data = JSON.parse(await (await fetch(url, { headers: { 'User-Agent': UA } })).text());
        } catch {
          if (attempt === 6) throw new Error('Wikipédia refuse les affiches, réessayer plus tard');
          console.warn(`  ! affiches ${i} essai ${attempt} : débit limité`);
          await sleep(10000 * attempt);
        }
      }
      fs.writeFileSync(file, JSON.stringify(data));
      await sleep(1000);
      process.stdout.write(`\r  affiches ${Math.min(i + 50, enTitles.length)}/${enTitles.length}`);
    }
    const alias = {};
    for (const n of [...(data.query.normalized || []), ...(data.query.redirects || [])]) alias[n.to] = n.from;
    for (const p of data.query.pages || []) {
      if (!p.thumbnail) continue;
      let t = p.title;
      while (alias[t] && !batch.includes(t)) t = alias[t];
      out[t] = p.thumbnail.source;
    }
  }
  return out;
}

(async () => {
  // 1. Candidats : les titres présents dans le plus de Wikipédias, année par année.
  const kind = {}, links = {};
  const years = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i);
  const found = await pool(years, 3, async (y) => {
    const f = await sparql(candidatesQuery(FILM_TYPES, 'P577', y, FILMS_PER_YEAR), `films-${y}-${FILMS_PER_YEAR}`);
    const s = await sparql(candidatesQuery(SERIES_TYPES, 'P580', y, SERIES_PER_YEAR), `series-${y}-${SERIES_PER_YEAR}`);
    console.log(`${y} : ${f.length} films, ${s.length} séries`);
    return [f, s];
  });
  for (const [f, s] of found) {
    for (const r of f) { kind[r.item] ??= 'film'; links[r.item] = +r.links; }
    for (const r of s) { kind[r.item] ??= 'serie'; links[r.item] = +r.links; }
  }
  const ids = Object.keys(kind);
  console.log(`${ids.length} candidats, détails en cours...`);

  // 2. Détails par lots.
  const items = {}, names = {};
  const batches = [];
  for (let i = 0; i < ids.length; i += 60) batches.push(ids.slice(i, i + 60));
  let done = 0;
  const details = await pool(batches, 3, async (batch) => {
    const info = await sparql(infoQuery(batch), `info-${batch[0]}-${batch.length}`);
    const rel = await sparql(relQuery(batch), `rel-${batch[0]}-${batch.length}`);
    process.stdout.write(`\r  ${(done += batch.length)}/${ids.length}`);
    return [info, rel];
  });
  for (const [info, rel] of details) {
    for (const r of info) {
      const it = (items[r.item] ??= { id: r.item, k: kind[r.item], l: links[r.item], d: [], a: [], s: [], g: [], c: [], dates: [] });
      it.t ??= r.fr; it.o ??= r.en; it.desc ??= r.desc; it.enwiki ??= r.enwiki;
      if (r.d && /^\d{4}/.test(r.d)) it.dates.push(+r.d.slice(0, 4));
    }
    for (const r of rel) {
      const key = PROPS[r.p.split('/').pop()];
      const it = items[r.item];
      if (!it || it[key].includes(r.v)) continue;
      it[key].push(r.v);
      if (!names[r.v] || /^Q\d+$/.test(names[r.v])) names[r.v] = r.vLabel;
    }
  }

  // Le service de libellés renvoie parfois l'identifiant au lieu du nom : on redemande ceux-là.
  const unnamed = Object.keys(names).filter((v) => /^Q\d+$/.test(names[v]));
  for (let i = 0; i < unnamed.length; i += 200) {
    const batch = unnamed.slice(i, i + 200);
    const rows = await sparql(`SELECT ?v ?fr ?en ?mul WHERE { VALUES ?v { ${values(batch)} }
      OPTIONAL { ?v rdfs:label ?fr FILTER(LANG(?fr) = "fr") } OPTIONAL { ?v rdfs:label ?en FILTER(LANG(?en) = "en") } OPTIONAL { ?v rdfs:label ?mul FILTER(LANG(?mul) = "mul") } }`, `labels-${batch[0]}-${batch.length}`);
    for (const r of rows) if (r.fr || r.en || r.mul) names[r.v] = r.fr || r.en || r.mul;
  }
  if (unnamed.length) console.log(`${unnamed.length} noms redemandés`);
  console.log();

  // 3. Nettoyage : année = plus ancienne date connue, on écarte ce qui sort de la période ou n'a pas de titre.
  const list = Object.values(items)
    .map((it) => ({ ...it, y: Math.min(...it.dates) }))
    .filter((it) => it.y >= FROM && it.y <= TO && (it.t || it.o) && !/^Q\d+$/.test(it.t || it.o));

  // On ne garde que les acteurs, sagas et genres qui relient au moins quelques titres du catalogue.
  const count = {};
  for (const it of list) for (const k of ['a', 's', 'g']) for (const v of it[k]) count[v] = (count[v] || 0) + 1;
  const keep = { a: 3, s: 2, g: 15 };

  // 4. Identifiants IMDb et TMDB des films : correspondance exacte à l'import dans Letterboxd.
  const ext = {};
  const filmIds = list.filter((it) => it.k === 'film').map((it) => it.id);
  for (let i = 0; i < filmIds.length; i += 200) {
    const batch = filmIds.slice(i, i + 200);
    const rows = await sparql(`SELECT ?item ?imdb ?tmdb WHERE { VALUES ?item { ${values(batch)} }
      OPTIONAL { ?item wdt:P345 ?imdb } OPTIONAL { ?item wdt:P4947 ?tmdb } }`, `ids-${batch[0]}-${batch.length}`);
    for (const r of rows) {
      const e = (ext[r.item] ??= {});
      e.im ??= r.imdb;
      e.tm ??= r.tmdb;
    }
  }

  // 5. Affiches.
  const img = await posters([...new Set(list.map((it) => it.enwiki).filter(Boolean))]);

  const used = new Set();
  const out = list
    .sort((x, y) => y.l - x.l)
    .map((it) => {
      const o = {
        id: it.id, k: it.k, t: it.t || it.o, y: it.y, l: it.l,
        d: it.d, a: it.a.filter((v) => count[v] >= keep.a), s: it.s.filter((v) => count[v] >= keep.s),
        g: it.g.filter((v) => count[v] >= keep.g), fr: it.c.includes('Q142') ? 1 : 0,
      };
      if (it.o && it.o !== o.t) o.o = it.o;
      if (it.desc) o.desc = it.desc;
      if (ext[it.id]?.im) o.im = ext[it.id].im;
      if (ext[it.id]?.tm) o.tm = +ext[it.id].tm;
      if (img[it.enwiki]) o.img = img[it.enwiki].replace('https://upload.wikimedia.org/wikipedia/', '');
      for (const k of ['d', 'a', 's', 'g']) o[k].forEach((v) => used.add(v));
      return o;
    });
  const dict = Object.fromEntries([...used].filter((v) => names[v]).map((v) => [v, names[v]]));

  const catalog = { built: new Date().toISOString().slice(0, 10), from: FROM, to: TO, names: dict, items: out };
  fs.writeFileSync(OUT, 'window.CATALOG = ' + JSON.stringify(catalog) + ';\n');
  const films = out.filter((o) => o.k === 'film').length;
  console.log(`OK : ${films} films, ${out.length - films} séries, ${out.filter((o) => o.img).length} affiches → ${OUT}`);
})();
