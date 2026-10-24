/* Motor de gustos y selección. No es machine learning: son pesos con tope y reglas claras. */

function qvShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function qvClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const Weights = {
  all() { return Store.get('weights', {}); },

  // Los gustos se guardan POR TEMÁTICA: "giro final" en misterio no empuja en comedia.
  contextsForSearch(genreIds) {
    return genreIds && genreIds.length ? genreIds.map(String) : ['_any'];
  },
  contextsForRating(requested, movieGenres) {
    if (!requested || !requested.length) return ['_any'];
    const inter = requested.filter(function (g) { return movieGenres.indexOf(g) !== -1; });
    return (inter.length ? inter : requested).map(String);
  },

  // Gustos activos para esta búsqueda (los más fuertes primero).
  topTags(genreIds, n) {
    const w = this.all();
    const ctxs = this.contextsForSearch(genreIds);
    const res = [];
    QV.TAGS.forEach(function (tag) {
      let best = 0;
      ctxs.forEach(function (c) {
        const v = (w[c] && w[c][tag.id]) || 0;
        if (v > best) best = v;
      });
      if (best >= QV.W_ACTIVE) res.push({ tag: tag, weight: best });
    });
    res.sort(function (a, b) { return b.weight - a.weight; });
    return res.slice(0, n);
  },

  // 4-5★ suma, 1-2★ resta, 3★ no mueve nada.
  update(ctxs, tagIds, stars) {
    if (!tagIds.length || stars === 3) return;
    const delta = stars >= 4 ? 1 : -1;
    const w = this.all();
    ctxs.forEach(function (c) {
      w[c] = w[c] || {};
      tagIds.forEach(function (t) {
        w[c][t] = qvClamp((w[c][t] || 0) + delta, QV.W_MIN, QV.W_MAX);
      });
    });
    Store.set('weights', w);
  },

  // Cada DECAY_EVERY días de uso distintos, los pesos pierden fuerza para que el perfil no se fosilice.
  decayIfNewDay() {
    const today = new Date().toISOString().slice(0, 10);
    const meta = Store.get('sessionMeta', { day: null, count: 0 });
    if (meta.day === today) return;
    meta.day = today;
    meta.count += 1;
    if (meta.count % QV.DECAY_EVERY === 0) {
      const w = this.all();
      Object.keys(w).forEach(function (c) {
        Object.keys(w[c]).forEach(function (t) {
          w[c][t] *= QV.DECAY_FACTOR;
          if (Math.abs(w[c][t]) < 0.2) delete w[c][t];
        });
        if (!Object.keys(w[c]).length) delete w[c];
      });
      Store.set('weights', w);
    }
    Store.set('sessionMeta', meta);
  },

  // Edición manual, etiqueta a etiqueta
  setWeight(ctx, tagId, value) {
    const w = this.all();
    w[ctx] = w[ctx] || {};
    w[ctx][tagId] = qvClamp(value, QV.W_MIN, QV.W_MAX);
    Store.set('weights', w);
  },
  remove(ctx, tagId) {
    const w = this.all();
    if (!w[ctx]) return;
    delete w[ctx][tagId];
    if (!Object.keys(w[ctx]).length) delete w[ctx];
    Store.set('weights', w);
  },

  reset() { Store.remove('weights'); }
};

const Picker = {
  // Reparte las propuestas: mínimo EXPLORE_MIN sin boost, máximo MAX_BOOSTED con boost de gustos.
  pick(general, boosted, excluded, n) {
    const ok = function (m) { return !excluded.has(m._key); };
    const B = qvShuffle(boosted.filter(ok));
    const bIds = new Set(boosted.map(function (m) { return m._key; }));
    const G = qvShuffle(general.filter(function (m) { return ok(m) && !bIds.has(m._key); }));
    const out = [];

    const exploreN = Math.min(QV.EXPLORE_MIN, G.length);
    for (let i = 0; i < exploreN; i++) out.push({ movie: G.shift(), kind: 'explore' });

    const boostN = Math.min(QV.MAX_BOOSTED, B.length, n - out.length);
    for (let i = 0; i < boostN; i++) out.push({ movie: B.shift(), kind: 'match' });

    while (out.length < n && G.length) out.push({ movie: G.shift(), kind: 'explore' });
    while (out.length < n && B.length) out.push({ movie: B.shift(), kind: 'match' }); // solo si no queda otra cosa

    return qvShuffle(out);
  }
};
