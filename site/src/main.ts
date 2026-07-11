import './styles.css';
import { geometry } from 'path-geometry';
import type { BuildFramesOptions, GeometryData, PathFrames, RibbonSide, Vector3 } from 'path-geometry';
import { GeometryLab } from './lab';
import type { MaterialSide } from './lab';
import { buildPresetPath, presets } from './presets';
import type { PathMode, PresetId } from './presets';

type SceneId = 'sampling' | 'frames' | 'tube' | 'ribbon' | 'extrude';
type InitialNormal = 'auto' | 'y' | 'z';

interface State {
  scene: SceneId;
  preset: PresetId;
  pathMode: PathMode;
  divisions: number;
  marker: number;
  initialNormal: InitialNormal;
  transport: boolean;
  fixLine: boolean;
  close: boolean;
  radius: number;
  radialSegments: number;
  startCap: boolean;
  endCap: boolean;
  width: number;
  side: RibbonSide;
  arrow: boolean;
  sharp: boolean;
  wireframe: boolean;
  normals: boolean;
  materialSide: MaterialSide;
  withHole: boolean;
  alongPath: boolean;
  generateTop: boolean;
  generateBottom: boolean;
}

const state: State = {
  scene: 'sampling',
  preset: 'spatial',
  pathMode: 'smooth',
  divisions: 18,
  marker: 0.42,
  initialNormal: 'auto',
  transport: true,
  fixLine: true,
  close: false,
  radius: 0.55,
  radialSegments: 12,
  startCap: true,
  endCap: true,
  width: 1.5,
  side: 'both',
  arrow: true,
  sharp: true,
  wireframe: false,
  normals: false,
  materialSide: 'front',
  withHole: true,
  alongPath: true,
  generateTop: true,
  generateBottom: true
};

const sceneInfo: Record<SceneId, { title: string; kicker: string; description: string }> = {
  sampling: {
    title: 'Path sampling',
    kicker: '01 / PATH',
    description: 'Compare raw parameter samples with points distributed by arc length.'
  },
  frames: {
    title: 'Transported frames',
    kicker: '02 / FRAMES',
    description: 'Inspect tangent, normal and binormal continuity along a spatial route.'
  },
  tube: {
    title: 'Tube geometry',
    kicker: '03 / MESH',
    description: 'Validate rings, caps, normals, UVs and indexed triangle winding.'
  },
  ribbon: {
    title: 'Ribbon geometry',
    kicker: '04 / MESH',
    description: 'Exercise side selection, sharp joins, width scaling and arrow heads.'
  },
  extrude: {
    title: 'Shape extrusion',
    kicker: '05 / MESH',
    description: 'Extrude a contour with an optional hole in depth or along path frames.'
  }
};

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="path-geometry home"><span class="brand-mark"></span>path-geometry</a>
    <div class="topbar-actions">
      <span class="renderer-badge">THREE.JS ADAPTER</span>
      <a href="./api/">API reference ↗</a>
      <a href="https://github.com/shawn0326/path-geometry">GitHub ↗</a>
    </div>
  </header>
  <main class="workspace">
    <nav class="scene-nav" aria-label="Geometry examples">
      ${(['sampling', 'frames', 'tube', 'ribbon', 'extrude'] as SceneId[]).map((id, index) => `
        <button class="scene-tab" data-scene="${id}"><span>0${index + 1}</span>${sceneInfo[id].title}</button>
      `).join('')}
    </nav>
    <section class="viewport-shell">
      <div id="viewport" class="viewport" aria-label="Interactive Three.js geometry viewport"></div>
      <div class="viewport-copy">
        <p id="kicker" class="kicker"></p>
        <h1 id="title"></h1>
        <p id="description"></p>
      </div>
      <div class="legend" id="legend"></div>
      <button id="reset-camera" class="camera-button">Reset view</button>
      <div id="error" class="error" role="alert" hidden></div>
    </section>
    <aside class="panel">
      <section>
        <p class="section-label">Input</p>
        <label>Preset<select id="preset">
          ${(Object.entries(presets) as Array<[PresetId, (typeof presets)[PresetId]]>).map(([id, preset]) => `<option value="${id}">${preset.label}</option>`).join('')}
        </select></label>
        <p id="preset-description" class="hint"></p>
        <label>Path type<select id="path-mode">
          <option value="polyline">Polyline</option><option value="smooth">Smooth curve</option><option value="beveled">Beveled curve</option>
        </select></label>
        <label class="check"><input id="close" type="checkbox"> Close path</label>
      </section>
      <section>
        <p class="section-label">Frames</p>
        <label>Curve divisions <output id="divisions-value"></output><input id="divisions" type="range" min="2" max="48" step="1"></label>
        <label>Initial normal<select id="initial-normal"><option value="auto">Automatic</option><option value="y">Y axis</option><option value="z">Z axis</option></select></label>
        <label class="check"><input id="transport" type="checkbox"> Parallel transport</label>
        <label class="check"><input id="fix-line" type="checkbox"> Fix line transitions</label>
        <label data-scenes="sampling">Marker position <output id="marker-value"></output><input id="marker" type="range" min="0" max="1" step="0.01"></label>
      </section>
      <section data-scenes="tube">
        <p class="section-label">Tube</p>
        <label>Radius <output id="radius-value"></output><input id="radius" type="range" min="0.1" max="1.5" step="0.05"></label>
        <label>Radial segments <output id="radial-value"></output><input id="radial-segments" type="range" min="3" max="32" step="1"></label>
        <label class="check"><input id="start-cap" type="checkbox"> Start cap</label>
        <label class="check"><input id="end-cap" type="checkbox"> End cap</label>
      </section>
      <section data-scenes="ribbon">
        <p class="section-label">Ribbon</p>
        <label>Width <output id="width-value"></output><input id="width" type="range" min="0.2" max="3" step="0.1"></label>
        <label>Side<select id="side"><option value="both">Both</option><option value="left">Left</option><option value="right">Right</option></select></label>
        <label class="check"><input id="arrow" type="checkbox"> Arrow head</label>
        <label class="check"><input id="sharp" type="checkbox"> Sharp joins</label>
      </section>
      <section data-scenes="extrude">
        <p class="section-label">Extrusion</p>
        <label class="check"><input id="with-hole" type="checkbox"> Contour hole</label>
        <label class="check"><input id="along-path" type="checkbox"> Extrude along path</label>
        <label class="check"><input id="generate-top" type="checkbox"> Generate top</label>
        <label class="check"><input id="generate-bottom" type="checkbox"> Generate bottom</label>
      </section>
      <section data-scenes="tube ribbon extrude">
        <p class="section-label">Inspection</p>
        <label class="check"><input id="wireframe" type="checkbox"> Wireframe</label>
        <label class="check"><input id="normals" type="checkbox"> Vertex normals</label>
        <label>Material side<select id="material-side"><option value="front">Front only</option><option value="double">Double sided</option><option value="back">Back only</option></select></label>
      </section>
      <section class="stats-section">
        <p class="section-label">Output</p>
        <div id="stats" class="stats"></div>
      </section>
      <details>
        <summary>Minimal usage</summary>
        <pre><code id="code"></code></pre>
      </details>
    </aside>
  </main>
`;

const lab = new GeometryLab(document.querySelector('#viewport')!);

function input<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

function frameOptions(): BuildFramesOptions {
  const result: BuildFramesOptions = {
    divisions: state.divisions,
    transport: state.transport,
    fixLine: state.fixLine,
    close: effectiveClose()
  };
  if (state.initialNormal === 'y') result.initialNormal = [0, 1, 0];
  if (state.initialNormal === 'z') result.initialNormal = [0, 0, 1];
  return result;
}

function effectiveClose(): boolean {
  if (state.preset === 'mixed') return false;
  if (state.preset === 'closed') return true;
  return state.close;
}

function updatePresetControls(): void {
  const fixedMixedPath = state.preset === 'mixed';
  const fixedClosedPath = state.preset === 'closed';
  const pathMode = input<HTMLSelectElement>('path-mode');
  const close = input<HTMLInputElement>('close');

  pathMode.disabled = fixedMixedPath;
  close.disabled = fixedMixedPath || fixedClosedPath;
  close.checked = fixedClosedPath ? true : fixedMixedPath ? false : state.close;
  pathMode.closest('label')?.classList.toggle('disabled', fixedMixedPath);
  close.closest('label')?.classList.toggle('disabled', fixedMixedPath || fixedClosedPath);
}

function meshStats(data: GeometryData): string {
  return `<span><b>${data.positions.length / 3}</b> vertices</span><span><b>${data.indices.length / 3}</b> triangles</span>`;
}

function codeForScene(scene: SceneId): string {
  if (scene === 'sampling') return `const route = path.create()\n  .setSmoothCurve(points, { smooth: 0.35 });\n\nconst raw = route.getPoints(18);\nconst spaced = route.getSpacedPoints(18);`;
  if (scene === 'frames') return `const frames = route.buildFrames({\n  divisions: 18,\n  transport: true,\n  initialNormal: [0, 1, 0]\n});`;
  if (scene === 'tube') return `const frames = route.buildFrames({ divisions: 18 });\nconst mesh = geometry.createTube(frames, {\n  radius: 0.55,\n  radialSegments: 12,\n  generateStartCap: true,\n  generateEndCap: true\n});`;
  if (scene === 'ribbon') return `const frames = route.buildFrames({ divisions: 18 });\nconst mesh = geometry.createRibbon(frames, {\n  width: 1.5,\n  side: 'both',\n  arrow: true,\n  sharp: true\n});`;
  return `const frames = route.buildFrames({ divisions: 18 });\nconst mesh = geometry.createExtrudeShape({\n  contour,\n  holes: [hole],\n  pathFrames: frames\n});`;
}

function rebuild(): void {
  const info = sceneInfo[state.scene];
  input<HTMLElement>('title').textContent = info.title;
  input<HTMLElement>('kicker').textContent = info.kicker;
  input<HTMLElement>('description').textContent = info.description;
  const presetNote = state.preset === 'mixed'
    ? ' Path type and closure are fixed for this line + cubic fixture.'
    : state.preset === 'closed'
      ? ' Closure is fixed for this seam-continuity fixture.'
      : '';
  input<HTMLElement>('preset-description').textContent = presets[state.preset].description + presetNote;
  updatePresetControls();
  input<HTMLElement>('code').textContent = codeForScene(state.scene);
  document.querySelectorAll<HTMLElement>('[data-scenes]').forEach(element => {
    element.hidden = !element.dataset.scenes!.split(' ').includes(state.scene);
  });
  document.querySelectorAll('.scene-tab').forEach(element => element.classList.toggle('active', (element as HTMLElement).dataset.scene === state.scene));
  input<HTMLElement>('error').hidden = true;
  lab.clear();

  try {
    const route = buildPresetPath(state.preset, state.pathMode, effectiveClose());
    const frames = route.buildFrames(frameOptions());
    lab.addPath(route);
    let stats = `<span><b>${route.segments.length}</b> segments</span><span><b>${route.getLength().toFixed(2)}</b> length</span>`;

    if (state.scene === 'sampling') {
      const raw = route.getPoints(state.divisions);
      const spaced = route.getSpacedPoints(state.divisions);
      const marker: Vector3 = [0, 0, 0];
      route.pointAtU(marker, state.marker);
      lab.addControlStructure(route);
      lab.addSampling(raw, spaced, presets[state.preset].points);
      lab.addMarker(marker);
      stats += `<span><b>${raw.length}</b> raw samples</span><span><b>${spaced.length}</b> spaced</span>`;
      input<HTMLElement>('legend').innerHTML = '<span class="raw">● parameter</span><span class="spaced">● arc length</span><span class="input-dot">● input</span>';
    } else if (state.scene === 'frames') {
      lab.addFrames(frames);
      stats += `<span><b>${frames.points.length}</b> frames</span><span><b>${frames.sharps.filter(Boolean).length}</b> sharp</span>`;
      input<HTMLElement>('legend').innerHTML = '<span class="tangent">— tangent</span><span class="normal">— normal</span><span class="binormal">— binormal</span>';
    } else {
      let data: GeometryData;
      if (state.scene === 'tube') {
        data = geometry.createTube(frames, {
          radius: state.radius,
          radialSegments: state.radialSegments,
          generateStartCap: state.startCap,
          generateEndCap: state.endCap
        });
      } else if (state.scene === 'ribbon') {
        data = geometry.createRibbon(frames, { width: state.width, side: state.side, arrow: state.arrow, sharp: state.sharp });
      } else {
        const contour = [[-0.9, -0.65], [-0.9, 0.65], [0.9, 0.65], [0.9, -0.65]];
        const holes = state.withHole ? [[[-0.38, -0.25], [0.38, -0.25], [0.38, 0.25], [-0.38, 0.25]]] : undefined;
        data = geometry.createExtrudeShape({
          contour,
          ...(holes ? { holes } : {}),
          ...(state.alongPath ? { pathFrames: frames } : { depth: 3 }),
          generateTop: state.generateTop,
          generateBottom: state.generateBottom
        });
      }
      lab.addMesh(data, { wireframe: state.wireframe, normals: state.normals, side: state.materialSide });
      stats += meshStats(data);
      input<HTMLElement>('legend').innerHTML = '<span>drag to orbit · scroll to zoom</span>';
    }
    input<HTMLElement>('stats').innerHTML = stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorElement = input<HTMLElement>('error');
    errorElement.textContent = message;
    errorElement.hidden = false;
    input<HTMLElement>('stats').innerHTML = '<span><b>Invalid</b> geometry</span>';
  }
}

function setInitialValues(): void {
  input<HTMLSelectElement>('preset').value = state.preset;
  input<HTMLSelectElement>('path-mode').value = state.pathMode;
  input<HTMLInputElement>('divisions').value = String(state.divisions);
  input<HTMLInputElement>('marker').value = String(state.marker);
  input<HTMLSelectElement>('initial-normal').value = state.initialNormal;
  input<HTMLInputElement>('transport').checked = state.transport;
  input<HTMLInputElement>('fix-line').checked = state.fixLine;
  input<HTMLInputElement>('close').checked = state.close;
  input<HTMLInputElement>('radius').value = String(state.radius);
  input<HTMLInputElement>('radial-segments').value = String(state.radialSegments);
  input<HTMLInputElement>('start-cap').checked = state.startCap;
  input<HTMLInputElement>('end-cap').checked = state.endCap;
  input<HTMLInputElement>('width').value = String(state.width);
  input<HTMLSelectElement>('side').value = state.side;
  input<HTMLInputElement>('arrow').checked = state.arrow;
  input<HTMLInputElement>('sharp').checked = state.sharp;
  input<HTMLInputElement>('wireframe').checked = state.wireframe;
  input<HTMLInputElement>('normals').checked = state.normals;
  input<HTMLSelectElement>('material-side').value = state.materialSide;
  input<HTMLInputElement>('with-hole').checked = state.withHole;
  input<HTMLInputElement>('along-path').checked = state.alongPath;
  input<HTMLInputElement>('generate-top').checked = state.generateTop;
  input<HTMLInputElement>('generate-bottom').checked = state.generateBottom;
}

function updateOutputs(): void {
  input<HTMLOutputElement>('divisions-value').value = String(state.divisions);
  input<HTMLOutputElement>('marker-value').value = state.marker.toFixed(2);
  input<HTMLOutputElement>('radius-value').value = state.radius.toFixed(2);
  input<HTMLOutputElement>('radial-value').value = String(state.radialSegments);
  input<HTMLOutputElement>('width-value').value = state.width.toFixed(1);
}

const bindings: Record<string, (target: HTMLInputElement | HTMLSelectElement) => void> = {
  preset: target => { state.preset = target.value as PresetId; },
  'path-mode': target => { state.pathMode = target.value as PathMode; },
  divisions: target => { state.divisions = Number(target.value); },
  marker: target => { state.marker = Number(target.value); },
  'initial-normal': target => { state.initialNormal = target.value as InitialNormal; },
  transport: target => { state.transport = (target as HTMLInputElement).checked; },
  'fix-line': target => { state.fixLine = (target as HTMLInputElement).checked; },
  close: target => { state.close = (target as HTMLInputElement).checked; },
  radius: target => { state.radius = Number(target.value); },
  'radial-segments': target => { state.radialSegments = Number(target.value); },
  'start-cap': target => { state.startCap = (target as HTMLInputElement).checked; },
  'end-cap': target => { state.endCap = (target as HTMLInputElement).checked; },
  width: target => { state.width = Number(target.value); },
  side: target => { state.side = target.value as RibbonSide; },
  arrow: target => { state.arrow = (target as HTMLInputElement).checked; },
  sharp: target => { state.sharp = (target as HTMLInputElement).checked; },
  wireframe: target => { state.wireframe = (target as HTMLInputElement).checked; },
  normals: target => { state.normals = (target as HTMLInputElement).checked; },
  'material-side': target => { state.materialSide = target.value as MaterialSide; },
  'with-hole': target => { state.withHole = (target as HTMLInputElement).checked; },
  'along-path': target => { state.alongPath = (target as HTMLInputElement).checked; },
  'generate-top': target => { state.generateTop = (target as HTMLInputElement).checked; },
  'generate-bottom': target => { state.generateBottom = (target as HTMLInputElement).checked; }
};

document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(element => {
  element.addEventListener('input', () => {
    bindings[element.id]?.(element);
    updateOutputs();
    rebuild();
  });
});
document.querySelectorAll<HTMLButtonElement>('.scene-tab').forEach(button => button.addEventListener('click', () => {
  state.scene = button.dataset.scene as SceneId;
  rebuild();
}));
input<HTMLButtonElement>('reset-camera').addEventListener('click', () => lab.resetCamera());

setInitialValues();
updateOutputs();
rebuild();
