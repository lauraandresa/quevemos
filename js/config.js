/* Constantes de la app. Aquí NO hay ninguna clave: la API key la mete el usuario en la app. */
const QV = {
  REGION: 'ES',
  LANGUAGE: 'es-ES',
  API_BASE: 'https://api.themoviedb.org/3',
  IMG_BASE: 'https://image.tmdb.org/t/p/w185',
  LOGO_BASE: 'https://image.tmdb.org/t/p/w92',

  // Filtros duros
  ANIMATION_GENRE: 16,      // solo sale si elegís "Animación"
  MIN_RUNTIME: 40,          // descarta cortos
  MIN_VOTES: 150,           // descarta películas casi desconocidas
  MIN_VOTES_RELAXED: 20,    // si no sale nada, se relaja una vez
  MAX_PAGES: 8,

  // Selección
  RESULTS_PER_ROUND: 5,
  EXPLORE_MIN: 2,           // mínimo de propuestas "sin boost de gustos"
  MAX_BOOSTED: 2,           // máximo de propuestas empujadas por gustos (de 5)

  // Pesos de gustos
  W_MIN: -3,
  W_MAX: 5,
  W_ACTIVE: 0.5,            // peso mínimo para que un gusto empuje
  DECAY_EVERY: 5,           // cada 5 días de uso distintos...
  DECAY_FACTOR: 0.9,        // ...los pesos pierden un 10%
  MAX_TAGS_PER_RATING: 2,
  MANUAL_WEIGHT: 2,         // peso que se da a un gusto añadido a mano

  // Etiquetas de "por qué". kw = búsquedas en palabras clave de TMDB (en inglés).
  // Solo se usan las que coinciden EXACTAMENTE con el nombre de una keyword real.
  TAGS: [
    { id: 'twist',      label: 'Giro final',         kw: ['twist ending', 'plot twist', 'surprise ending'] },
    { id: 'slow',       label: 'Ritmo pausado',      kw: ['slow burn', 'slow paced'] },
    { id: 'fast',       label: 'Ritmo trepidante',   kw: ['fast paced', 'fast-paced'] },
    { id: 'happy',      label: 'Final feliz',        kw: ['happy ending', 'feel good'] },
    { id: 'bittersweet',label: 'Final agridulce',    kw: ['bittersweet', 'bittersweet ending'] },
    { id: 'darkhumor',  label: 'Humor negro',        kw: ['dark comedy', 'black comedy', 'dark humor'] },
    { id: 'true',       label: 'Hechos reales',      kw: ['based on true story', 'based on a true story', 'true story'] },
    { id: 'ensemble',   label: 'Reparto coral',      kw: ['ensemble cast'] },
    { id: 'tension',    label: 'Tensión constante',  kw: ['suspense', 'tension'] },
    { id: 'emotional',  label: 'Emotiva',            kw: ['tearjerker', 'heartwarming', 'emotional'] }
  ]
};
