/* Controlador de la interfaz. */
(function () {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const SCREENS = ['onboarding', 'form', 'results', 'pending', 'settings'];

  const state = {
    screen: null, stack: [],
    duration: 120, genres: new Set(), genreList: [],
    query: null, pool: null, shown: new Set(), busy: false,
    ratingItem: null, ratingStars: 0, ratingTags: new Set()
  };

  /* ---------- utilidades ---------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function explain(e) {
    switch (e && e.message) {
      case 'BAD_KEY': return 'La clave de TMDB no es válida. Revisadla en Ajustes.';
      case 'NETWORK': return 'No hay conexión con TMDB. Comprobad internet.';
      case 'NO_KEY': return 'Falta la clave de TMDB (Ajustes).';
      default: return 'Algo falló al hablar con TMDB (' + ((e && e.message) || 'error') + ').';
    }
  }

  function fmtRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + (m ? m + 'min' : '').trim() : m + 'min';
  }

  /* ---------- navegación ---------- */
  function show(name, push) {
    if (push !== false && state.screen && state.screen !== name) state.stack.push(state.screen);
    state.screen = name;
    SCREENS.forEach(function (s) { $('#screen-' + s).hidden = (s !== name); });
    $('#btn-back').hidden = (name === 'form' || name === 'onboarding');
    window.scrollTo(0, 0);
    if (name === 'form') renderPendingWidget();
    if (name === 'pending') renderPending();
    if (name === 'settings') renderSettings();
  }
  function goBack() { show(state.stack.pop() || 'form', false); }
  function goHome() { state.stack = []; show('form', false); }

  /* ---------- formulario ---------- */
  function renderDurations() {
    $$('#duration-chips .chip').forEach(function (c) {
      c.classList.toggle('is-active', Number(c.dataset.duration) === state.duration);
    });
  }

  async function loadGenres() {
    const box = $('#genre-chips');
    const err = $('#form-error');
    try {
      state.genreList = (await TMDB.genres()).filter(function (g) { return g.id !== 10770; });
    } catch (e) {
      err.textContent = explain(e); err.hidden = false; return;
    }
    box.innerHTML = '';
    state.genreList.forEach(function (g) {
      const b = document.createElement('button');
      b.className = 'chip' + (state.genres.has(g.id) ? ' is-active' : '');
      b.textContent = g.name;
      b.addEventListener('click', function () {
        if (state.genres.has(g.id)) state.genres.delete(g.id); else state.genres.add(g.id);
        b.classList.toggle('is-active');
      });
      box.appendChild(b);
    });
  }

  function renderPendingWidget() {
    const n = Store.get('pending', []).length;
    const w = $('#pending-widget');
    w.hidden = n === 0;
    if (n) $('#btn-view-pending').textContent = '🎬 ' + n + (n === 1 ? ' película pendiente de puntuar' : ' películas pendientes de puntuar');
  }

  /* ---------- búsqueda ---------- */
  async function startSearch() {
    const err = $('#form-error');
    err.hidden = true;
    const settings = Store.get('settings', { platforms: [] });
    if (!settings.platforms || !settings.platforms.length) {
      err.textContent = 'Antes de buscar, marcad vuestras plataformas en Ajustes (⚙ arriba a la derecha).';
      err.hidden = false; return;
    }
    state.query = { maxRuntime: state.duration, genreIds: Array.from(state.genres), providerIds: settings.platforms };
    state.pool = null;
    state.shown = new Set();
    Store.set('lastDuration', state.duration);
    show('results');
    await loadRound();
  }

  function excludedIds() {
    const ids = new Set(state.shown);
    Store.get('ratings', []).forEach(function (r) { ids.add(r.id); });
    Store.get('pending', []).forEach(function (p) { ids.add(p.id); });
    return ids;
  }

  async function ensurePool() {
    const q = state.query;
    if (!state.pool) {
      const P = state.pool = { general: [], boosted: [], queue: [], minVotes: QV.MIN_VOTES, topTags: [] };
      P.topTags = Weights.topTags(q.genreIds, QV.MAX_BOOSTED);

      let first = await TMDB.discover({ genreIds: q.genreIds, maxRuntime: q.maxRuntime, providerIds: q.providerIds, page: 1, minVotes: P.minVotes });
      if (!first.results || !first.results.length) {
        P.minVotes = QV.MIN_VOTES_RELAXED;
        first = await TMDB.discover({ genreIds: q.genreIds, maxRuntime: q.maxRuntime, providerIds: q.providerIds, page: 1, minVotes: P.minVotes });
      }
      P.general = (first.results || []).slice();
      const total = Math.min(first.total_pages || 1, QV.MAX_PAGES);
      const pages = [];
      for (let p = 2; p <= total; p++) pages.push(p);
      P.queue = qvShuffle(pages);

      for (const t of P.topTags) {
        const ids = await TMDB.keywordIds(t.tag);
        if (!ids.length) continue;
        const r = await TMDB.discover({ genreIds: q.genreIds, maxRuntime: q.maxRuntime, providerIds: q.providerIds, page: 1, minVotes: P.minVotes, keywordIds: ids });
        (r.results || []).forEach(function (m) {
          if (!P.boosted.some(function (b) { return b.id === m.id; })) {
            P.boosted.push(Object.assign({}, m, { _tag: t.tag.label }));
          }
        });
      }
    }

    // Mantener un colchón de candidatos disponibles (carga más páginas si hace falta)
    const P = state.pool;
    const available = function () {
      const ex = excludedIds();
      return P.general.filter(function (m) { return !ex.has(m.id); }).length;
    };
    while (available() < 25 && P.queue.length) {
      const pg = P.queue.shift();
      const r = await TMDB.discover({ genreIds: q.genreIds, maxRuntime: q.maxRuntime, providerIds: q.providerIds, page: pg, minVotes: P.minVotes });
      (r.results || []).forEach(function (m) {
        if (!P.general.some(function (g) { return g.id === m.id; })) P.general.push(m);
      });
    }
  }

  async function loadRound() {
    if (state.busy) return;
    state.busy = true;
    const list = $('#results-list');
    const actions = $('#results-actions');
    list.innerHTML = '<p class="muted">Buscando propuestas…</p>';
    actions.hidden = true;
    try {
      await ensurePool();
      const picks = Picker.pick(state.pool.general, state.pool.boosted, excludedIds(), QV.RESULTS_PER_ROUND);
      if (!picks.length) {
        list.innerHTML = '<p class="muted">No quedan más propuestas con ese filtro. Probad con otra duración, más temáticas o más plataformas.</p>';
        $('#btn-reroll').hidden = true; actions.hidden = false;
        return;
      }
      picks.forEach(function (p) { state.shown.add(p.movie.id); });
      const detailed = (await Promise.all(picks.map(function (p) {
        return TMDB.details(p.movie.id).then(function (d) { return Object.assign({}, p, { d: d }); }).catch(function () { return null; });
      }))).filter(Boolean);
      renderResults(detailed);
      $('#btn-reroll').hidden = false; actions.hidden = false;
    } catch (e) {
      list.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error-msg'; p.textContent = explain(e);
      list.appendChild(p);
      $('#btn-reroll').hidden = false; actions.hidden = false;
    } finally {
      state.busy = false;
    }
  }

  function providerBadges(d) {
    const sel = new Set(Store.get('settings', { platforms: [] }).platforms);
    const wp = d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results[QV.REGION];
    const flat = (wp && wp.flatrate) || [];
    return flat.filter(function (p) { return sel.has(p.provider_id); }).map(function (p) { return p.provider_name; });
  }

  function ticketHTML(o) {
    const poster = o.poster
      ? '<img class="ticket-poster" src="' + QV.IMG_BASE + esc(o.poster) + '" alt="" loading="lazy">'
      : '<div class="ticket-poster ticket-poster-ph">🎬</div>';
    return poster +
      '<div class="ticket-body">' +
        '<div class="ticket-title">' + esc(o.title) + '</div>' +
        '<div class="ticket-meta">' + esc(o.meta) + '</div>' +
        (o.badges ? '<div class="badge-row">' + o.badges + '</div>' : '') +
        (o.synopsis ? '<p class="ticket-synopsis">' + esc(o.synopsis) + '</p>' : '') +
        '<div class="ticket-actions">' + o.actions + '</div>' +
      '</div><span class="ticket-notch-bottom"></span>';
  }

  function renderResults(items) {
    const list = $('#results-list');
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<p class="muted">No se pudieron cargar los detalles. Probad con "otras 5".</p>'; return; }
    const showReasons = state.pool && state.pool.topTags.length > 0;
    items.forEach(function (it) {
      const d = it.d;
      const year = (d.release_date || '').slice(0, 4);
      const badges = providerBadges(d).map(function (n) { return '<span class="badge">' + esc(n) + '</span>'; }).join('');
      let reason = '';
      if (showReasons) {
        reason = it.kind === 'match'
          ? '<span class="badge badge--match">Os va: ' + esc(it.movie._tag || '') + '</span>'
          : '<span class="badge badge--explore">Algo distinto</span>';
      }
      const el = document.createElement('article');
      el.className = 'ticket';
      el.innerHTML = ticketHTML({
        poster: d.poster_path, title: d.title,
        meta: [year, fmtRuntime(d.runtime)].filter(Boolean).join(' · '),
        badges: badges + reason, synopsis: d.overview,
        actions: '<button class="ticket-cta">Esta, la vemos</button>'
      });
      el.querySelector('.ticket-cta').addEventListener('click', function () { choose(d); });
      list.appendChild(el);
    });
  }

  function choose(d) {
    const pending = Store.get('pending', []);
    if (!pending.some(function (p) { return p.id === d.id; })) {
      pending.push({
        id: d.id, title: d.title, year: (d.release_date || '').slice(0, 4),
        runtime: d.runtime || 0, poster: d.poster_path || '',
        context: state.query ? state.query.genreIds : [],
        movieGenres: (d.genres || []).map(function (g) { return g.id; })
      });
      Store.set('pending', pending);
    }
    $('#chosen-title').textContent = d.title;
    $('#modal-chosen').hidden = false;
  }

  /* ---------- pendientes y valoración ---------- */
  function renderPending() {
    const list = $('#pending-list');
    const pending = Store.get('pending', []);
    list.innerHTML = '';
    $('#pending-empty').hidden = pending.length > 0;
    pending.forEach(function (p) {
      const el = document.createElement('article');
      el.className = 'ticket';
      el.innerHTML = ticketHTML({
        poster: p.poster, title: p.title,
        meta: [p.year, fmtRuntime(p.runtime)].filter(Boolean).join(' · '),
        badges: '', synopsis: '',
        actions: '<button class="ticket-cta" data-act="rate">Puntuar</button><button class="ticket-link" data-act="drop">No la vimos</button>'
      });
      el.querySelector('[data-act="rate"]').addEventListener('click', function () { openRate(p); });
      el.querySelector('[data-act="drop"]').addEventListener('click', function () {
        Store.set('pending', Store.get('pending', []).filter(function (x) { return x.id !== p.id; }));
        renderPending(); renderPendingWidget();
      });
      list.appendChild(el);
    });
  }

  function paintStars() {
    $$('#rate-stars .star').forEach(function (s) {
      s.classList.toggle('is-filled', Number(s.dataset.value) <= state.ratingStars);
    });
  }

  function openRate(item) {
    state.ratingItem = item; state.ratingStars = 0; state.ratingTags = new Set();
    $('#rate-title').textContent = item.title;
    paintStars();
    const box = $('#rate-tags');
    box.innerHTML = '';
    QV.TAGS.forEach(function (t) {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = t.label;
      b.addEventListener('click', function () {
        if (state.ratingTags.has(t.id)) { state.ratingTags.delete(t.id); b.classList.remove('is-active'); return; }
        if (state.ratingTags.size >= QV.MAX_TAGS_PER_RATING) { toast('Máximo ' + QV.MAX_TAGS_PER_RATING + ' motivos'); return; }
        state.ratingTags.add(t.id); b.classList.add('is-active');
      });
      box.appendChild(b);
    });
    $('#modal-rate').hidden = false;
  }

  function saveRating(skipTags) {
    if (!state.ratingStars) { toast('Elegid de 1 a 5 estrellas'); return; }
    const item = state.ratingItem;
    const tags = skipTags ? [] : Array.from(state.ratingTags);
    const ratings = Store.get('ratings', []);
    ratings.push({ id: item.id, title: item.title, stars: state.ratingStars, tags: tags, at: Date.now() });
    Store.set('ratings', ratings);
    Weights.update(Weights.contextsForRating(item.context, item.movieGenres), tags, state.ratingStars);
    Store.set('pending', Store.get('pending', []).filter(function (x) { return x.id !== item.id; }));
    $('#modal-rate').hidden = true;
    toast('Guardado: ' + state.ratingStars + '★');
    renderPending(); renderPendingWidget();
  }

  /* ---------- ajustes ---------- */
  function genreName(id) {
    if (id === '_any') return 'Cualquier temática';
    const g = state.genreList.filter(function (x) { return String(x.id) === id; })[0];
    return g ? g.name : '#' + id;
  }

  function renderWeights() {
    const box = $('#weights-preview');
    box.innerHTML = '';
    const w = Weights.all();
    const pills = [];
    Object.keys(w).forEach(function (c) {
      QV.TAGS.forEach(function (t) {
        const v = w[c][t.id];
        if (v && v >= QV.W_ACTIVE) pills.push(genreName(c) + ' · ' + t.label + ' (+' + v.toFixed(1) + ')');
      });
    });
    if (!pills.length) { box.innerHTML = '<span class="muted small">Todavía no hay nada aprendido.</span>'; return; }
    pills.forEach(function (txt) {
      const s = document.createElement('span');
      s.className = 'weight-pill'; s.textContent = txt;
      box.appendChild(s);
    });
  }

  async function renderSettings() {
    const inp = $('#input-api-key-settings');
    inp.value = '';
    inp.placeholder = Store.get('apiKey', '') ? '•••••••• (guardada; escribe para cambiarla)' : 'Pega aquí tu clave';
    renderWeights();
    const box = $('#platform-list');
    box.innerHTML = '<p class="muted small">Cargando plataformas…</p>';
    try {
      const provs = await TMDB.providers();
      const sel = new Set(Store.get('settings', { platforms: [] }).platforms);
      box.innerHTML = '';
      provs.forEach(function (p) {
        const row = document.createElement('label');
        row.className = 'platform-row';
        row.innerHTML =
          '<span class="platform-row-left">' +
          (p.logo ? '<img src="' + QV.LOGO_BASE + esc(p.logo) + '" alt="">' : '') +
          '<span>' + esc(p.name) + '</span></span>' +
          '<input type="checkbox"' + (sel.has(p.id) ? ' checked' : '') + '>';
        row.querySelector('input').addEventListener('change', function (e) {
          const s = Store.get('settings', { platforms: [] });
          const set = new Set(s.platforms);
          if (e.target.checked) set.add(p.id); else set.delete(p.id);
          s.platforms = Array.from(set);
          Store.set('settings', s);
        });
        box.appendChild(row);
      });
    } catch (e) {
      box.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error-msg'; p.textContent = explain(e);
      box.appendChild(p);
    }
  }

  async function applyKey(raw) {
    const key = raw.trim();
    if (!key) return { ok: false, msg: 'Pega tu clave primero.' };
    const prev = Store.get('apiKey', '');
    Store.set('apiKey', key);
    Store.remove('cacheGenres');
    try {
      await TMDB.genres();
      return { ok: true };
    } catch (e) {
      if (prev) Store.set('apiKey', prev); else Store.remove('apiKey');
      return { ok: false, msg: explain(e) };
    }
  }

  /* ---------- arranque ---------- */
  async function initForm() {
    state.duration = Store.get('lastDuration', 120);
    renderDurations();
    show('form', false);
    await loadGenres();
  }

  function bindEvents() {
    $('#btn-back').addEventListener('click', goBack);
    $('#btn-settings').addEventListener('click', function () { if (state.screen !== 'settings' && state.screen !== 'onboarding') show('settings'); });
    $('#btn-settings-done').addEventListener('click', goBack);

    $$('#duration-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () { state.duration = Number(c.dataset.duration); renderDurations(); });
    });
    $('#btn-search').addEventListener('click', startSearch);
    $('#btn-reroll').addEventListener('click', loadRound);
    $('#btn-new-search').addEventListener('click', goHome);
    $('#btn-view-pending').addEventListener('click', function () { show('pending'); });

    $('#btn-chosen-ok').addEventListener('click', function () { $('#modal-chosen').hidden = true; goHome(); });

    $$('#rate-stars .star').forEach(function (s) {
      s.addEventListener('click', function () { state.ratingStars = Number(s.dataset.value); paintStars(); });
    });
    $('#btn-rate-save').addEventListener('click', function () { saveRating(false); });
    $('#btn-rate-notags').addEventListener('click', function () { saveRating(true); });
    $('#btn-rate-cancel').addEventListener('click', function () { $('#modal-rate').hidden = true; });

    $('#btn-reset-weights').addEventListener('click', function () {
      if (confirm('¿Borrar todo lo aprendido de vuestros gustos? Las valoraciones pasadas se conservan, pero dejan de influir.')) {
        Weights.reset(); renderWeights(); toast('Gustos reiniciados');
      }
    });

    $('#btn-save-key').addEventListener('click', async function () {
      const err = $('#key-error'); err.hidden = true;
      const r = await applyKey($('#input-api-key').value);
      if (!r.ok) { err.textContent = r.msg; err.hidden = false; return; }
      $('#input-api-key').value = '';
      toast('Clave guardada');
      await initForm();
      show('settings');   // primer paso lógico: marcar plataformas
    });
    $('#btn-save-key-settings').addEventListener('click', async function () {
      const r = await applyKey($('#input-api-key-settings').value);
      toast(r.ok ? 'Clave actualizada' : r.msg);
      if (r.ok) renderSettings();
    });
  }

  async function boot() {
    Weights.decayIfNewDay();
    bindEvents();
    if (!Store.get('apiKey', '')) { show('onboarding', false); return; }
    await initForm();
  }

  boot();
})();
