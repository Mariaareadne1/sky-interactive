# SKY — progress

| Milestone | State |
|---|---|
| 0. Repo, sibling study, art direction | Done — forked from HIVE's engine (MEADOW lineage); `docs/ART_DIRECTION.md` |
| 1. Painted town tile, camera, light, shadows, clouds, small life | Done — seeded village, church with clock tower, fields and hedgerows, baked ground paint, chimney smoke, washing, the cat on the wall |
| 2. Paper plane model and origami fold-in | Done — four-step fold on a snapped sheet grid; fold-in, unfold on remove |
| 3. Stroke → 3D flight and flight feel | Done — flight sheet, drawing speed, loop detection, energy, rolling frames, bank, wobble, flex, loop streak, glide and landing |
| 4. Selection, four actions, dragging, undo/redo, persistence, capture, mobile | Done — 13 Playwright tests in Chromium (dev and production builds) |
| 5. Polish, scripted demo, gallery, README, case study | Done — `docs/media/`, `CASE_STUDY.md` |
| Deploy to Vercel | Waiting for the owner's go-ahead |

## Numbers (2026-10-27)

- 28 unit tests, 13 end-to-end tests; typecheck, lint and production build clean.
- Eight planes in flight at 2880×1800: median 5.8 ms, p99 8.3 ms per GPU-synced frame (machine load ≈ 7 on 12 cores).
- Demo: H.264 1600×900, ~20 s, 59 fps, recorded through the app's own recorder.

## Known gaps

See "What's incomplete" in `CASE_STUDY.md`.
