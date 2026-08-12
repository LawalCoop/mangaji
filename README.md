# Mangaji

Lector de manga que en vez de mostrar la página estática **dirige** la lectura: recorta cada
viñeta, mueve la cámara sobre ella, hace aparecer el diálogo secuenciado y suma pequeños
efectos por viñeta.

```
CBZ  ──[ mangacut ]──►  .cbza  ──[ reader ]──►  lectura dirigida
                     arte + manifest.json
```

La detección se hace **una sola vez** en un CLI local y queda guardada en un manifest JSON
editable. El reader solo reproduce un timeline determinista, y el editor permite corregir a
mano lo que la detección erró — porque ningún detector acierta el 100 %.

## Estructura

| | |
|---|---|
| `apps/reader` | Next.js + PixiJS. Lee, reproduce y edita. Todo en el cliente. |
| `packages/format` | Esquema del manifest `.cbza` (Zod). Fuente de verdad compartida. |
| `tools/mangacut` | CLI Python: detecta viñetas y globos, arma el `.cbza`. |

## Plan de versiones

Cada versión termina en algo que se abre y se usa.

- **v1** — Lector CBZ funcional. Núcleo extensible (`ArchiveSource`, `Stage`, `Camera`, `Director`, `FrameSource`).
- **v2** — Viñetas + cámara: lectura dirigida.
- **v3** — Editor de retoque.
- **v4** — Diálogo que aparece.
- **v5** — Efectos y ritmo.
- **v6** — ML, solo si las métricas lo justifican.

El modo página completa es el caso degenerado del modo viñeta: una viñeta que ocupa toda la
página. Por eso cada versión **suma un `FrameSource`** en vez de reemplazar el núcleo.

## Uso

```bash
pnpm install
pnpm dev            # reader en http://localhost:3000
```

## Privacidad

El reader corre entero en el navegador: no hay backend y ningún archivo se sube a ningún lado.
El repositorio no contiene manga — `samples/` está en `.gitignore` y los tests usan páginas
sintéticas generadas por código.
