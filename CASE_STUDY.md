# SKY — case study

## The brief

MEADOW let you draw a sheep. POND and HIVE kept the same hand and the same single gesture. SKY had to stay as simple: **one thing to draw (a flight path), one thing it makes (a paper plane).** No kites, no flocks, no physics sandbox, no settings — and if a feature was tempting, the instruction was to make the one thing better instead.

So the whole piece lives or dies on one moment: you draw a line, and a plane follows it. That moment had to feel like *your* line, be legible in depth on a flat screen, and feel like paper.

## Decisions

**A sheet in the air, not a guess at depth.** A 2D stroke has no depth. Rather than inferring it, SKY projects every point of the stroke onto an invisible, gently curved flight sheet over the town — higher at the far side, lower near the camera, domed slightly in the middle. Because the projection is along the view ray, the plane always flies exactly over the pixels you drew; the depth is supplied by the world, and the shadow tells you what it is.

**Speed from the hand.** Pointer timestamps give drawing speed in world units per second; a soft power curve maps it to flying speed (1.5–7 m/s). A careful stroke becomes a lazy glide, a flick a zippy swoop. An energy model then trades height for speed sample by sample — a dive speeds up, the top of a loop slows right down — with the drawn speed acting as "thrust" that pulls it back.

**Loops are found, not classified.** There is no stroke classifier. Wherever the line crosses itself (the shortest closed stretch from each segment), that curl is replaced with a vertical circle starting and ending at the crossing point, bulging a little sideways over the top as real loops do. Reduced motion simply skips this.

**Frames that roll, not tangents that snap.** Orientation comes from rotation-minimising frames (double reflection) along the dense ribbon, gently righted toward level flight — except inside loops, where righting is switched off so the frame rolls right over and the plane is inverted at the top. Bank comes from horizontal curvature (tan b = v²κ/g, softened and smoothed), applied about the tangent. Sharp corners in a hand-drawn line become quick, smooth rolls, never jumps; a unit test walks every flight frame by frame and fails on any jump.

**A pure flight.** Everything is a function of (path, time, seed): position, orientation, fold progress, flex, the ghost line's progress, the landing. There is no per-frame integration, so flights are testable (unit tests sample them directly), recordable at a fixed step, and identical on replay.

**Real origami.** The dart is a 49×49 grid folded in four steps, each a rotation about a crease of the points on one side of it as the sheet lay *before* that step — so layers already folded travel with the paper beneath them. The fold-in is the same rig run forward over 0.6 s; Remove runs it backward as the sheet drifts away. Two refinements made it read as paper: the grid's diagonals run with the first creases, and points near every later crease are snapped exactly onto it (one Newton step through the earlier, rigid folds), so edges are straight instead of stair-stepped; and folds stop a hair short of flat, leaving the springy thickness of a real fold. Facets are lit with screen-space derivative normals so every crease is a crisp change of tone.

**Landing on whatever is there.** When the line ends, the plane glides on: it eases into a glide slope, looks where it would come down and turns back over the village if that is off the tile, lifts over a low wall, banks away from a tall one, flares near the ground, and touches down on the surface function shared with everything else — roofs, the tower, tree crowns, the wall, lanes, the green. A short slide, a small bounce, and it rests tipped onto a wingtip, rocking slightly. Its resting place is saved without an undo step.

## What went wrong, and what it taught

- **The invisible shadow.** The first flights had no visible shadow at all — even though the plane was in the shadow map. Hiding the plane and diffing frames showed the shadow *was* there, at full strength, but MEADOW's contact-hardening penumbra grew so fast with height that a slim dart three metres up was blurred into nothing. A gentler softness slope (and a smaller fade with height) gave a crisp lavender dart when skimming roofs and a softer, fainter one high up. Lesson: a filter tuned for sheep and trees is wrong for a paper wing.
- **Roofs that couldn't be landed on.** The first glide logic lifted over anything higher ahead, which treated every roof *slope* as a wall — planes skipped over the church instead of settling on it. Distinguishing walls (a sudden step up) from slopes fixed it; the demo now lands on the church's front slope, and fifteen neighbouring line ends land in the same place.
- **A glide that wandered.** Steering looked five metres ahead regardless of height, so a line ending near the church triggered a hard turn south. The lookahead is now the real remaining glide distance.
- **Stair-stepped creases** (above): grid triangles straddling a diagonal crease read as a serrated edge until the grid was aligned and snapped to the creases.

## Checks

- 28 unit tests: stroke → path (resampling, speed mapping, loop detection with and without self-crossings, reduced motion, rejections), flight (continuity frame by frame, determinism, bank sign for left and right turns, energy in dives and climbs, loops inverted at the top, landing on the surface and at rest, steering back over town, progress along the line, take-off arcs), the fold (flat start, symmetric pointed dart, continuous, wing flex), persistence validation and undo/redo.
- 13 Playwright tests in real Chromium with WebGL (Metal ANGLE), against both the dev server and the production build: the painted town on paper; a drawn plane following the drawn line on screen; its shadow on the ground down-sun of it (hiding the plane brightens that spot); landing on a surface; loops; rejected strokes; all four actions; the keyboard; dragging and undoing a drag; undo/redo/clear/reload; corrupt storage and a bad import; PNG download; eight planes at once with no errors; reduced motion; mobile touch.
- Performance (GPU-synced, back-to-back frames with a readback after each): eight planes in flight at 2880×1800, median 5.8 ms, p99 8.3 ms per frame, on a dev machine with load ≈ 7 on 12 cores. 1440×900: median 2.6 ms.
- The demo is recorded by the app's own recorder with the ink composited in: H.264, 1600×900, 20 s, ~1200 frames at 59 fps, frame interval median 16.6 ms / p99 21.6 ms (ffprobe).

## What's incomplete

(Live at https://sky-interactive.vercel.app.)

- Only Chromium is tested; Safari and Firefox are untested.
- The plane is lit and shadowed but doesn't cast onto other planes in a meaningful way, and planes pass through each other (collisions were out of scope by design).
- A plane that stalls against a tall wall flutters straight down beside it — honest, but less graceful than a landing.
- Planes are drawn larger than life (a dart about a cottage wide) for legibility; the label reports it as the real 0.30 m paper dart.
