/* Cliente mínimo de la API v3 de TMDB. */
const TMDB = {
  async request(path, params) {
    const key = Store.get('apiKey', '');
    if (!key) throw new Error('NO_KEY');
    const url = new URL(QV.API_BASE + path);
    const headers = {};
    // Acepta la "API Key" v3 (32 caracteres) o el "Access Token" v4 (empieza por eyJ)
    if (key.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + key;
    else url.searchParams.set('api_key', key);
    Object.entries(params || {}).forEach(function (kv) {
      if (kv[1] !== undefined && kv[1] !== null && kv[1] !== '') url.searchParams.set(kv[0], kv[1]);
    });
    let res;
    try { res = await fetch(url.toString(), { headers: headers }); }
    catch (e) { throw new Error('NETWORK'); }
    if (res.status === 401) throw new Error('BAD_KEY');
    if (!res.ok) throw new Error('HTTP_' + res.status);
    return res.json();
  },

  async cached(name, ttlDays, fetcher) {
    const c = Store.get(name, null);
    const now = Date.now();
    if (c && c.data && (now - c.t) < ttlDays * 86400000) return c.data;
    const data = await fetcher();
    Store.set(name, { t: now, data: data });
    return data;
  },

  genres() {
    return this.cached('cacheGenres', 30, async () => {
      const d = await this.request('/genre/movie/list', { language: QV.LANGUAGE });
      return d.genres || [];
    });
  },

  // Plataformas de películas + series (unidas, sin repetir)
  providers() {
    return this.cached('cacheProviders2', 14, async () => {
      const get = (t) => this.request('/watch/providers/' + t, { watch_region: QV.REGION, language: QV.LANGUAGE });
      const d = await get('movie');
      let tv = { results: [] };
      try { tv = await get('tv'); } catch (e) { if (e.message === 'BAD_KEY' || e.message === 'NETWORK') throw e; }
      const byId = {};
      (d.results || []).concat(tv.results || []).forEach(function (p) {
        const prio = p.display_priorities && p.display_priorities[QV.REGION];
        const cur = { id: p.provider_id, name: p.provider_name, logo: p.logo_path, prio: prio === undefined ? 999 : prio };
        if (!byId[cur.id] || cur.prio < byId[cur.id].prio) byId[cur.id] = cur;
      });
      return Object.keys(byId).map(function (k) { return byId[k]; })
        .sort(function (a, b) { return a.prio - b.prio; }).slice(0, 40);
    });
  },

  // Convierte una etiqueta nuestra en ids reales de keywords de TMDB (solo coincidencias exactas).
  async keywordIds(tag) {
    const norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); };
    const cache = Store.get('cacheKeywords', {});
    if (Array.isArray(cache[tag.id])) return cache[tag.id];
    const ids = [];
    for (const q of tag.kw) {
      try {
        const d = await this.request('/search/keyword', { query: q });
        (d.results || []).forEach(function (r) {
          if (norm(r.name) === norm(q) && ids.indexOf(r.id) === -1) ids.push(r.id);
        });
      } catch (e) {
        if (e.message === 'BAD_KEY' || e.message === 'NETWORK') throw e;
      }
    }
    cache[tag.id] = ids;
    Store.set('cacheKeywords', cache);
    return ids;
  },

  // Películas o series (o.type) en streaming por suscripción en vuestras plataformas.
  // En series, la duración filtra por la de cada capítulo.
  discover(o) {
    const isTv = o.type === 'tv';
    return this.request('/discover/' + (isTv ? 'tv' : 'movie'), {
      language: QV.LANGUAGE,
      region: isTv ? '' : QV.REGION,
      watch_region: QV.REGION,
      with_watch_providers: o.providerIds.join('|'),
      with_watch_monetization_types: 'flatrate',
      with_genres: (o.genreIds || []).join('|'),            // "|" = cualquiera de ellas
      without_genres: (o.genreIds || []).indexOf(QV.ANIMATION_GENRE) === -1 ? QV.ANIMATION_GENRE : '',  // animación solo si la pedís
      'with_runtime.gte': isTv ? QV.MIN_RUNTIME_TV : QV.MIN_RUNTIME,
      'with_runtime.lte': o.maxRuntime < 9999 ? o.maxRuntime : '',
      'vote_count.gte': o.minVotes,
      with_keywords: (o.keywordIds || []).join('|'),
      sort_by: 'popularity.desc',
      include_adult: isTv ? '' : 'false',
      page: o.page || 1
    });
  },

  // Detalle de película o serie: duración, géneros y plataformas en una sola llamada.
  async details(type, id) {
    const path = '/' + (type === 'tv' ? 'tv' : 'movie') + '/' + id;
    const d = await this.request(path, { language: QV.LANGUAGE, append_to_response: 'watch/providers' });
    if (!d.overview) {
      try {
        const en = await this.request(path, { language: 'en-US' });
        d.overview = en.overview || '';
      } catch (e) {}
    }
    return d;
  }
};
