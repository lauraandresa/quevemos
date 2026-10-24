/* Persistencia local (localStorage). Todo vive solo en este dispositivo. */
const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('qv_' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('qv_' + key, JSON.stringify(value)); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem('qv_' + key); } catch (e) {}
  }
};
