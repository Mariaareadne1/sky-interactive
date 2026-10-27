# SKY — art direction

SKY is the fourth piece in the family after MEADOW (draw a sheep), POND and HIVE: the same hand, a new world, and still one gesture. **You draw a line in the sky; a little paper plane flies it.** Everything here is measured against MEADOW's "Illustrated aerial references" (`meadow/docs/REFERENCE_ANALYSIS.md`) — a painted tile on warm paper — and against the siblings' interface.

## What carries over unchanged
- **Tile on paper.** A rounded rectangle of painted ground on `#f4efe4`, its edge thinning into dry-brush specks. The town is an object on a page.
- **One painted light.** `paintLight`: a warm lit side and a cool lavender shade (`#bdb9e3`); sun high, upper left, slightly in front; shadows fall lower right. One sun shadow map for everything, with contact hardening.
- **Gouache texture.** Flat-ish fields with soft internal gradients, long dry-brush strokes, a fine pigment stipple, pale flecks, the odd daisy. No photo textures, no gloss, no black.
- **Puff modelling.** Trees and clouds are MEADOW's fleece fields (soft clumped SDF surfaces with a dry-brush silhouette). Clouds travel along the tile's edges and never park over the middle.
- **Interface.** Inter Tight + Fraunces, wordmark top left ("SKY / *draw a flight*"), cream pill toolbar, a thin blue selection box with a world-unit label, a contextual bar under the selection.

## The world: a village from above
- **Town in the middle, fields at the edges.** The aerial references' patchwork (fresh green, yellow-green, gold, one ploughed parcel) divided by dark feathered hedgerows rings a village of grass.
- **Lanes** of packed sandy earth: a high street front to back, a cross lane, a back lane to the west and a path up to the church door. Paler down the middle, faint ruts, ragged verges.
- **Houses line the lanes** (laid out by a seeded walk along each lane, so the town is the same on every visit): plaster walls in creams and pale ochres, gabled roofs in terracotta, slate blue and cream thatch, painted tile courses, chimneys, cottage windows with glazing bars, a coloured front door facing the lane. Back gardens are little kitchen plots: rows of greens, round cabbage heads, a hedge border.
- **The landmark** is a stone church with a clock tower and a slate spire. The clock keeps (slow) time.
- **Small life, never competing with the planes:** two chimneys trailing curls of smoke, washing swaying on a line in a back garden, a black cat on the churchyard wall flicking its tail.

## The plane
- **One object, folded by one hand.** A classic dart folded from a square of cream paper — corners to the centre, edges to the centre again, in half, wings out. Every plane is the same fold with small per-plane differences (paper tint, nose sharpness, wing dihedral, keel depth).
- **Paper, not plastic.** Facets are flat between creases (screen-space derivative normals), so each crease is a crisp change of tone; folds stop a hair short of flat, leaving paper's springy thickness. Fibre grain, two faint ruled lines and a pale pink margin. Thin paper lets a little warm light through on the shaded side.
- **Drawn larger than life.** About 1.25 world units long — nearly a cottage's width — like MEADOW's sheep. Labels speak of it as the real thing: a 0.30 m paper dart.
- **The shadow is the depth cue.** A crisp lavender dart on the roofs when it skims them; softer and a little fainter when it is high. It is the one thing that tells you how far up the plane is, so it must read at every height.

## Motion
- The plane follows *your* line exactly: strokes are projected onto an invisible flight sheet over the town, so it flies over what you drew over.
- Drawing speed is flying speed; a curl in the line is a loop-the-loop; it banks into turns, pitches with climbs and dives, speeds up downhill, wobbles faintly, flexes its wings in tight turns, and leaves a faint white streak through a loop.
- The drawn line stays as a ghost and is rubbed out behind the plane, like a pencil line being followed.
- When the line ends it glides on, comes down on whatever is under it — a roof, the green, a lane, a tree — slides a little, bounces once and rests, rocking very slightly in the breeze.

## Rules learned from the siblings
- `new THREE.Color('#hex')` is already linear; don't convert again.
- Shadows never arrive before the thing that casts them (a fresh plane's sheet pops in with its shadow).
- Things mid-reveal stay pickable (a plane can be selected while it is still folding).
- Canvas-only recording loses the SVG ink; the recorder composites the line in, honouring how much of it has been rubbed out.
- Contact-hardening must be gentle for slim casters: a filter wider than a paper dart's wing erases its shadow.
