# ¿Qué vemos?

Recomendador de películas para decidir en un minuto qué ver esta noche. Funciona como app instalable (PWA) desde un enlace de GitHub Pages. Sin servidor, sin cuentas: todo vive en el móvil.

## 1. Sacar la clave de TMDB (gratis)

1. Regístrate en https://www.themoviedb.org/signup y confirma el email.
2. Entra en tu perfil → **Ajustes → API** (https://www.themoviedb.org/settings/api).
3. Pulsa **Solicitar clave de API**, elige uso **personal / no comercial** y rellena el formulario (nombre de la app: "¿Qué vemos?", URL: la de tu GitHub Pages o tu perfil de GitHub, descripción: "app personal para elegir películas").
4. Copia la **"API Key" (v3)**: son 32 caracteres. (También vale el "Access Token de lectura", el que empieza por `eyJ`.)

**La clave NO va en el código.** La pegas dentro de la app la primera vez que la abres y se guarda solo en ese navegador.

## 2. Subir a GitHub

1. Crea un repositorio nuevo (por ejemplo `que-vemos`). En cuentas gratuitas, GitHub Pages suele requerir que sea **público**; no pasa nada, no hay ningún secreto en el repo.
2. Descomprime el zip y sube **el contenido** (no la carpeta que lo contiene): `index.html` tiene que quedar en la raíz del repo. Arrastra los archivos en *Add file → Upload files*.
3. Sube también tus iconos a la carpeta `icons/` con estos nombres exactos:
   - `icons/icon-192.png` (192×192 px)
   - `icons/icon-512.png` (512×512 px)
4. En el repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
5. En 1-2 minutos tendrás el enlace: `https://TU-USUARIO.github.io/que-vemos/`

## 3. Instalarla en el móvil

- **Android (Chrome):** abre el enlace → menú ⋮ → *Instalar aplicación* / *Añadir a pantalla de inicio*.
- **iPhone (Safari, tiene que ser Safari):** abre el enlace → botón Compartir → *Añadir a pantalla de inicio*.

Ábrela **desde el icono instalado** y haz el primer arranque ahí: pega la clave de TMDB y marca vuestras plataformas. En iPhone, la app instalada guarda sus datos aparte de Safari, así que si la clave la pegaste en Safari tendrás que pegarla otra vez dentro de la app instalada.

## Cómo funciona

- **Formulario:** duración máxima, formato (película, serie o lo que sea) y temáticas (puedes elegir varias; sin elegir = cualquiera). Las plataformas están en Ajustes.
- **Series:** en series la duración es la de **cada capítulo** ("< 1 h" = capítulos de menos de una hora). Los gustos aprendidos valen para películas y series. Se descartan automáticamente noticias, reality, culebrones, tertulias y series infantiles (salvo que elijáis Familia).
- **5 propuestas** que cumplen los filtros duros: en streaming por suscripción en *vuestras* plataformas (España), dentro de la duración y la temática. Las de **animación solo salen si elegís la temática Animación**.
- **Sinopsis:** toca la tarjeta (o "Leer sinopsis completa") para desplegarla entera.
- **"Otras 5"** nunca repite lo ya mostrado en la sesión, ni lo ya elegido o puntuado.
- **Elegir → puntuar:** "Esta, la vemos" la guarda en *Pendientes*. Cuando la terminéis, la puntuáis de 1 a 5★ y, si queréis, con hasta 2 motivos.
- **Aprendizaje (no es machine learning, son pesos con tope):**
  - 4-5★ suma +1 a los motivos elegidos, 1-2★ resta 1, 3★ no mueve nada.
  - Se guarda **por temática**: "giro final" en Misterio no empuja en Comedia.
  - Tope: **máximo 2 de las 5 propuestas** pueden venir empujadas por vuestros gustos, y **mínimo 3 son "algo distinto"**.
  - Cada 5 días de uso, los pesos pierden un 10% para que el perfil no se fosilice.
  - El peso de cada motivo tiene tope (+5) por mucho que lo repitáis.
  - En **Ajustes → Gustos aprendidos** podéis quitar cualquier gusto con la × y añadir uno a mano (temática + etiqueta). Un gusto añadido a mano arranca con peso +2, y sigue sujeto al mismo tope de 2 de 5.

## Limitaciones conocidas

- Los datos de plataformas vienen de JustWatch a través de TMDB: pueden ir con retraso y alguna película puede haber salido ya del catálogo.
- Películas de menos de 1 h hay muy pocas; con "< 1 h" y formato película saldrán pocas propuestas. Para eso están las series.
- En series **no existen** las temáticas Terror, Romance, Música ni Historia (TMDB no las tiene para series): salen apagadas al elegir "Serie". Con "Lo que sea" esas temáticas solo traen películas.
- Las temáticas de series son equivalencias: Acción y Aventura → Acción/Aventura; Ciencia ficción y Fantasía → Fantasía/Ciencia ficción; Suspense → Misterio.
- Los datos (clave, valoraciones, gustos) están **en cada dispositivo**: no se sincronizan entre vuestros móviles.
- Los motivos que restan (1-2★) se guardan pero de momento no se usan para descartar nada.
- Los motivos ("giro final", etc.) se buscan en las palabras clave de TMDB, que son colaborativas y no cubren todas las películas. Si un motivo no se encuentra, simplemente no empuja.

## Créditos

Esta app usa la API de TMDB pero no está respaldada ni certificada por TMDB. Los datos de disponibilidad por plataforma los aporta JustWatch.
