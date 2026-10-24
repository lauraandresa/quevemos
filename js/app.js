/* Controlador de la interfaz. */
(function () {
  'use strict';
  window.__QV_APP_VERSION = 4;

  // Si un elemento no existe (index.html desactualizado), devuelve uno suelto en vez de lanzar un error
  // que dejaría TODOS los botones muertos. El aviso de versión de index.html explica qué falta.
  const $ = function (s) { return document.querySelector(s) || document.createElement('div'); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  const esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const SCREENS = ['onboarding', 'form', 'results', 'pending', 'settings'];

  const state = {
    screen: null, stack: [],
    duration: 120, media: 'both', genres: new Set(), genreList: [],
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
    return h ? h + 'h' + (m ? ' ' + m + 'min' : '') : m + 'min';
  }

  // Los ids de película y de serie se pueden repetir: la identidad es "tipo:id".
  // Lo guardado antes de que existieran las series no tiene tipo y se trata como película.
  function keyOf(type, id) { return (type || 'movie') + ':' + id; }

  function metaLine(o) {
    const parts = [];
    if (o.year) parts.push(o.year);
    if (o.type === 'tv') {
      if (o.seasons) parts.push(o.seasons + (o.seasons === 1 ? ' temporada' : ' temporadas'));
      if (o.runtime) parts.push('~' + o.runtime + ' min/cap.');
    } else if (o.runtime) {
      parts.push(fmtRuntime(o.runtime));
    }
    return parts.join(' · ');
  }

  // Normaliza el detalle de TMDB (película o serie) a una sola forma.
  function normalize(type, d) {
    const isTv = type === 'tv';
    const ep = (d.episode_run_time && d.episode_run_time.length ? d.episode_run_time[0] : 0) ||
               (d.last_episode_to_air && d.last_episode_to_air.runtime) || 0;
    return {
      type: type, id: d.id,
      title: isTv ? d.name : d.title,
      year: ((isTv ? d.first_air_date : d.release_date) || '').slice(0, 4),
      runtime: isTv ? ep : (d.runtime || 0),
      seasons: isTv ? (d.number_of_seasons || 0) : 0,
      poster: d.poster_path || '',
      overview: d.overview || '',
      genres: (d.genres || []).map(function (g) { return g.id; }),
      raw: d
    };
  }

  // Géneros de la serie/película expresados como géneros de película (para los gustos por temática)
  function asMovieGenres(type, ids) {
    if (type !== 'tv') return ids.slice();
    const out = [];
    ids.forEach(function (id) {
      (QV.TV_TO_MOVIE[id] || []).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); });
    });
    return out;
  }

  // Temáticas elegidas (ids de película) -> ids de género para cada tipo
  function genresFor(type, ids) {
    if (type !== 'tv') return ids.slice();
    const out = [];
    ids.forEach(function (id) {
      (QV.MOVIE_TO_TV[id] || []).forEach(function (t) { if (out.indexOf(t) === -1) out.push(t); });
    });
    return out;
  }

  // Descartes que no dependen del servidor: animación si no la pedís, y programas que no son "ver en pareja".
  function keep(m, type, selected) {
    const g = m.genre_ids || [];
    const minYear = state.query && state.query.minYear;
    if (minYear) {
      const y = Number(String(m.release_date || m.first_air_date || '').slice(0, 4));
      if (!y || y < minYear) return false;
    }
    if (selected.indexOf(QV.ANIMATION_GENRE) === -1 && g.indexOf(QV.ANIMATION_GENRE) !== -1) return false;
    if (type === 'tv') {
      if (g.some(function (x) { return QV.TV_EXCLUDED_GENRES.indexOf(x) !== -1; })) return false;
      if (selected.indexOf(QV.FAMILY_GENRE) === -1 && g.indexOf(QV.KIDS_GENRE) !== -1) return false;
    }
    return true;
  }

  function decorate(m, type, tagLabel) {
    const out = Object.assign({}, m, { _type: type, _key: keyOf(type, m.id) });
    if (tagLabel) out._tag = tagLabel;
    return out;
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

  function renderMedia() {
    $$('#media-chips .chip').forEach(function (c) {
      c.classList.toggle('is-active', c.dataset.media === state.media);
    });
    $('#media-hint').hidden = state.media === 'movie';
    // En "solo series", las temáticas que no existen en series se ven apagadas
    $$('#genre-chips .chip').forEach(function (c) {
      const none = state.media === 'tv' && (QV.MOVIE_TO_TV[Number(c.dataset.id)] || []).length === 0;
      c.classList.toggle('is-dim', none);
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
      b.dataset.id = g.id;
      b.addEventListener('click', function () {
        if (state.genres.has(g.id)) state.genres.delete(g.id); else state.genres.add(g.id);
        b.classList.toggle('is-active');
      });
      box.appendChild(b);
    });
    renderMedia();
  }

  function renderPendingWidget() {
    const n = Store.get('pending', []).length;
    const w = $('#pending-widget');
    w.hidden = n === 0;
    if (n) $('#btn-view-pending').textContent = '🎬 ' + n + (n === 1 ? ' pendiente de puntuar' : ' pendientes de puntuar');
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
    const genreIds = Array.from(state.genres);
    if (state.media === 'tv' && genreIds.length && !genresFor('tv', genreIds).length) {
      err.textContent = 'Esas temáticas no existen en series (terror, romance, música e historia solo hay en películas). Elegid otras o cambiad el formato.';
      err.hidden = false; return;
    }
    state.query = { maxRuntime: state.duration, genreIds: genreIds, providerIds: settings.platforms, media: state.media, minYear: settings.minYear || null };
    state.pool = null;
    state.shown = new Set();
    Store.set('lastDuration', state.duration);
    Store.set('lastMedia', state.media);
    show('results');
    await loadRound();
  }

  function excludedIds() {
    const ids = new Set(state.shown);
    Store.get('ratings', []).forEach(function (r) { ids.add(keyOf(r.type, r.id)); });
    Store.get('pending', []).forEach(function (p) { ids.add(keyOf(p.type, p.id)); });
    return ids;
  }

  function baseOpts(src) {
    const q = state.query;
    return { type: src.type, genreIds: src.genreIds, maxRuntime: q.maxRuntime, providerIds: q.providerIds, minVotes: src.minVotes, minYear: q.minYear };
  }

  function addGeneral(P, src, results) {
    results.forEach(function (m) {
      if (!keep(m, src.type, state.query.genreIds)) return;
      const d = decorate(m, src.type);
      if (!P.general.some(function (g) { return g._key === d._key; })) P.general.push(d);
    });
  }

  async function ensurePool() {
    const q = state.query;
    if (!state.pool) {
      const P = state.pool = { general: [], boosted: [], sources: [], topTags: [] };
      P.topTags = Weights.topTags(q.genreIds, QV.MAX_BOOSTED);

      const types = q.media === 'both' ? ['movie', 'tv'] : [q.media];
      types.forEach(function (type) {
        const g = genresFor(type, q.genreIds);
        if (q.genreIds.length && !g.length) return;   // esa temática no existe en series
        P.sources.push({ type: type, genreIds: g, minVotes: QV.MIN_VOTES, queue: [] });
      });

      for (const src of P.sources) {
        let first = await TMDB.discover(Object.assign(baseOpts(src), { page: 1 }));
        if (!(first.results || []).length) {
          src.minVotes = QV.MIN_VOTES_RELAXED;
          first = await TMDB.discover(Object.assign(baseOpts(src), { page: 1 }));
        }
        addGeneral(P, src, first.results || []);
        const total = Math.min(first.total_pages || 1, QV.MAX_PAGES);
        const pages = [];
        for (let p = 2; p <= total; p++) pages.push(p);
        src.queue = qvShuffle(pages);
      }

      for (const t of P.topTags) {
        const ids = await TMDB.keywordIds(t.tag);
        if (!ids.length) continue;
        for (const src of P.sources) {
          const r = await TMDB.discover(Object.assign(baseOpts(src), { page: 1, keywordIds: ids }));
          (r.results || []).forEach(function (m) {
            if (!keep(m, src.type, q.genreIds)) return;
            const d = decorate(m, src.type, t.tag.label);
            if (!P.boosted.some(function (b) { return b._key === d._key; })) P.boosted.push(d);
          });
        }
      }
    }

    // Mantener un colchón de candidatos (carga más páginas de cada fuente si hace falta)
    const P = state.pool;
    const available = function () {
      const ex = excludedIds();
      return P.general.filter(function (m) { return !ex.has(m._key); }).length;
    };
    let guard = 0;
    while (available() < 25 && P.sources.some(function (s) { return s.queue.length; }) && guard++ < 20) {
      for (const src of P.sources) {
        if (!src.queue.length) continue;
        const r = await TMDB.discover(Object.assign(baseOpts(src), { page: src.queue.shift() }));
        addGeneral(P, src, r.results || []);
      }
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
        list.innerHTML = '<p class="muted">No quedan más propuestas con ese filtro. Probad con otra duración, otro formato, más temáticas o más plataformas.</p>';
        $('#btn-reroll').hidden = true; actions.hidden = false;
        return;
      }
      picks.forEach(function (p) { state.shown.add(p.movie._key); });
      const detailed = (await Promise.all(picks.map(function (p) {
        return TMDB.details(p.movie._type, p.movie.id)
          .then(function (d) { return Object.assign({}, p, { n: normalize(p.movie._type, d) }); })
          .catch(function () { return null; });
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
        (o.synopsis && o.synopsis.length > 110 ? '<button class="ticket-more" data-act="more">Leer sinopsis completa ▾</button>' : '') +
        '<div class="ticket-actions">' + o.actions + '</div>' +
      '</div><span class="ticket-notch-bottom"></span>';
  }

  function renderResults(items) {
    const list = $('#results-list');
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<p class="muted">No se pudieron cargar los detalles. Probad con "otras 5".</p>'; return; }
    const showReasons = state.pool && state.pool.topTags.length > 0;
    items.forEach(function (it) {
      const n = it.n;
      const typeBadge = '<span class="badge badge--type">' + (n.type === 'tv' ? 'Serie' : 'Película') + '</span>';
      const provs = providerBadges(n.raw).map(function (name) { return '<span class="badge">' + esc(name) + '</span>'; }).join('');
      let reason = '';
      if (showReasons) {
        reason = it.kind === 'match'
          ? '<span class="badge badge--match">Os va: ' + esc(it.movie._tag || '') + '</span>'
          : '<span class="badge badge--explore">Algo distinto</span>';
      }
      const el = document.createElement('article');
      el.className = 'ticket';
      el.innerHTML = ticketHTML({
        poster: n.poster, title: n.title, meta: metaLine(n),
        badges: typeBadge + provs + reason, synopsis: n.overview,
        actions: '<button class="ticket-cta">Esta, la vemos</button>'
      });
      el.querySelector('.ticket-cta').addEventListener('click', function (e) { e.stopPropagation(); choose(n); });
      const more = el.querySelector('[data-act="more"]');
      const toggle = function () {
        const open = el.classList.toggle('is-open');
        if (more) more.textContent = open ? 'Ocultar sinopsis ▴' : 'Leer sinopsis completa ▾';
      };
      if (more) { el.classList.add('is-tappable'); el.addEventListener('click', toggle); }
      list.appendChild(el);
    });
  }

  function choose(n) {
    const pending = Store.get('pending', []);
    if (!pending.some(function (p) { return keyOf(p.type, p.id) === keyOf(n.type, n.id); })) {
      pending.push({
        type: n.type, id: n.id, title: n.title, year: n.year,
        runtime: n.runtime, seasons: n.seasons, poster: n.poster,
        context: state.query ? state.query.genreIds : [],
        movieGenres: asMovieGenres(n.type, n.genres)
      });
      Store.set('pending', pending);
    }
    $('#chosen-title').textContent = n.title;
    $('#modal-chosen').hidden = false;
  }

  /* ---------- pendientes y valoración ---------- */
  function renderPending() {
    const list = $('#pending-list');
    const pending = Store.get('pending', []);
    list.innerHTML = '';
    $('#pending-empty').hidden = pending.length > 0;
    pending.forEach(function (p) {
      const typeBadge = '<span class="badge badge--type">' + (p.type === 'tv' ? 'Serie' : 'Película') + '</span>';
      const el = document.createElement('article');
      el.className = 'ticket';
      el.innerHTML = ticketHTML({
        poster: p.poster, title: p.title, meta: metaLine(p),
        badges: typeBadge, synopsis: '',
        actions: '<button class="ticket-cta" data-act="rate">Puntuar</button><button class="ticket-link" data-act="drop">No la vimos</button>'
      });
      el.querySelector('[data-act="rate"]').addEventListener('click', function () { openRate(p); });
      el.querySelector('[data-act="drop"]').addEventListener('click', function () {
        Store.set('pending', Store.get('pending', []).filter(function (x) { return keyOf(x.type, x.id) !== keyOf(p.type, p.id); }));
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
    ratings.push({ type: item.type || 'movie', id: item.id, title: item.title, stars: state.ratingStars, tags: tags, at: Date.now() });
    Store.set('ratings', ratings);
    Weights.update(Weights.contextsForRating(item.context, item.movieGenres), tags, state.ratingStars);
    Store.set('pending', Store.get('pending', []).filter(function (x) { return keyOf(x.type, x.id) !== keyOf(item.type, item.id); }));
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
        if (v && v >= QV.W_ACTIVE) pills.push({ ctx: c, tag: t, text: genreName(c) + ' · ' + t.label });
      });
    });
    if (!pills.length) { box.innerHTML = '<span class="muted small">Todavía no hay nada aprendido.</span>'; }
    pills.forEach(function (p) {
      const s = document.createElement('span');
      s.className = 'weight-pill';
      const txt = document.createElement('span');
      txt.textContent = p.text;
      const x = document.createElement('button');
      x.className = 'pill-x'; x.textContent = '×';
      x.setAttribute('aria-label', 'Quitar ' + p.text);
      x.addEventListener('click', function () { Weights.remove(p.ctx, p.tag.id); renderWeights(); });
      s.appendChild(txt); s.appendChild(x);
      box.appendChild(s);
    });
  }

  function renderAddTaste() {
    const g = $('#add-taste-genre'), t = $('#add-taste-tag');
    g.innerHTML = '<option value="_any">Cualquier temática</option>' +
      state.genreList.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
    t.innerHTML = QV.TAGS.map(function (x) { return '<option value="' + x.id + '">' + esc(x.label) + '</option>'; }).join('');
  }

  async function renderSettings() {
    const inp = $('#input-api-key-settings');
    $('#input-min-year').value = Store.get('settings', { platforms: [] }).minYear || '';
    inp.value = '';
    inp.placeholder = Store.get('apiKey', '') ? '•••••••• (guardada; escribe para cambiarla)' : 'Pega aquí tu clave';
    if (!state.genreList.length) { try { state.genreList = (await TMDB.genres()).filter(function (x) { return x.id !== 10770; }); } catch (e) {} }
    renderAddTaste();
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
    state.media = Store.get('lastMedia', 'both');
    renderDurations();
    renderMedia();
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
    $$('#media-chips .chip').forEach(function (c) {
      c.addEventListener('click', function () { state.media = c.dataset.media; renderMedia(); });
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

    $('#input-min-year').addEventListener('change', function (e) {
      const raw = e.target.value.trim();
      const s = Store.get('settings', { platforms: [] });
      if (raw === '') { s.minYear = null; Store.set('settings', s); toast('Sin año mínimo'); return; }
      const y = Math.floor(Number(raw));
      const max = new Date().getFullYear();
      if (!(y >= 1900 && y <= max)) {
        toast('Poned un año entre 1900 y ' + max);
        e.target.value = s.minYear || '';
        return;
      }
      s.minYear = y; Store.set('settings', s);
      e.target.value = y;
      toast('Solo estrenos desde ' + y);
    });
    $('#input-min-year').addEventListener('input', function (e) {
      const raw = e.target.value.trim();
      if (!/^\d{4}$/.test(raw)) return;
      const y = Number(raw);
      if (y < 1900 || y > new Date().getFullYear()) return;
      const s = Store.get('settings', { platforms: [] });
      s.minYear = y; Store.set('settings', s);
    });
    $('#btn-add-taste').addEventListener('click', function () {
      Weights.setWeight($('#add-taste-genre').value, $('#add-taste-tag').value, QV.MANUAL_WEIGHT);
      renderWeights(); toast('Gusto añadido');
    });
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
