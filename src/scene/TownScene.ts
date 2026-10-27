import type { Engine } from '../engine/Engine';
import { createTerrain, type Terrain } from './terrain';
import { createBuildings } from './buildings';
import { createProps, type Props } from './props';

/** The town's fixed furniture: painted ground, buildings, trees, clouds and its small signs of life. */
export class TownScene {
  readonly terrain: Terrain;
  readonly props: Props;
  private readonly rebake = () => this.terrain.bake(this.engine.renderer);

  constructor(private readonly engine: Engine) {
    const { world, scene } = engine;
    this.terrain = createTerrain(world);
    this.terrain.bake(engine.renderer);
    scene.add(this.terrain.mesh);
    scene.add(createBuildings(world));
    this.props = createProps(world, engine.reducedMotion);
    scene.add(this.props.group);
    engine.onFrame((dt, t) => this.props.update(dt, t));
    // a lost context loses the baked ground with it
    engine.canvas.addEventListener('webglcontextrestored', this.rebake);
  }

  dispose(): void {
    this.engine.canvas.removeEventListener('webglcontextrestored', this.rebake);
    this.terrain.dispose();
  }
}
