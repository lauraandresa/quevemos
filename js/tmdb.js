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

  providers() {
    return this.cached('cacheProviders', 14, async () => {
      const d = await this.request('/watch/providers/movie', { watch_region: QV.REGION, language: QV.LANGUAGE });
      return (d.results || []).map(function (p) {
        const prio = p.display_priorities && p.display_priorities[QV.REGION];
        return { id: p.provider_id, name: p.provider_name, logo: p.logo_path, prio: prio === undefined ? 999 : prio };
      }).sort(function (a, b) { return a.prio - b.prio; }).slice(0, 40);
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

  // Películas en streaming (suscripción) en vuestras plataformas, dentro de la duración y temáticas pedidas.
  discover(o) {
    return this.request('/discover/movie', {
      language: QV.LANGUAGE,
      region: QV.REGION,
      watch_region: QV.REGION,
      with_watch_providers: o.providerIds.join('|'),
      with_watch_monetization_types: 'flatrate',
      with_genres: (o.genreIds || []).join('|'),            // "|" = cualquiera de ellas
      without_genres: (o.genreIds || []).indexOf(QV.ANIMATION_GENRE) === -1 ? QV.ANIMATION_GENRE : '',  // animación solo si la pedís
      'with_runtime.gte': QV.MIN_RUNTIME,
      'with_runtime.lte': o.maxRuntime < 9999 ? o.maxRuntime : '',
      'vote_count.gte': o.minVotes,
      with_keywords: (o.keywordIds || []).join('|'),
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page: o.page || 1
    });
  },

  // Detalle: duración exacta, géneros y plataformas, en una sola llamada.
  async details(id) {
    let d = await this.request('/movie/' + id, { language: QV.LANGUAGE, append_to_response: 'watch/providers' });
    if (!d.overview) {
      try {
        const en = await this.request('/movie/' + id, { language: 'en-US' });
        d.overview = en.overview || '';
      } catch (e) {}
    }
    return d;
  }
};
