export interface SceneResourceSnapshot {
  renderers: number;
  controls: number;
  modelRoots: number;
  geometries: number;
  materials: number;
  textures: number;
  dragSessions: number;
}

type SceneResourceDelta = Partial<SceneResourceSnapshot>;
type Listener = () => void;

const emptySnapshot: SceneResourceSnapshot = {
  renderers: 0,
  controls: 0,
  modelRoots: 0,
  geometries: 0,
  materials: 0,
  textures: 0,
  dragSessions: 0
};

let snapshot = emptySnapshot;
const listeners = new Set<Listener>();

export function acquireSceneResources(delta: SceneResourceDelta): () => void {
  updateSnapshot(delta, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    updateSnapshot(delta, -1);
  };
}

export function getSceneResourceSnapshot() {
  return snapshot;
}

export function subscribeSceneResources(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateSnapshot(delta: SceneResourceDelta, direction: 1 | -1) {
  const next = { ...snapshot };
  for (const key of Object.keys(delta) as (keyof SceneResourceSnapshot)[]) {
    next[key] = Math.max(0, next[key] + (delta[key] ?? 0) * direction);
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}
