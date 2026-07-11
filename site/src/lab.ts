import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import type { GeometryData, Path, PathFrames, ReadonlyVector } from 'path-geometry';
import { createThreeGeometry } from './adapter';

const COLORS = {
  path: 0xe8edf7,
  input: 0xffc857,
  raw: 0xff6b6b,
  spaced: 0x4dd7b4,
  tangent: 0xff5b5b,
  normal: 0x65df82,
  binormal: 0x5b9dff,
  sharp: 0xffc857
};

export type MaterialSide = 'front' | 'double' | 'back';

const MATERIAL_SIDES: Record<MaterialSide, THREE.Side> = {
  front: THREE.FrontSide,
  double: THREE.DoubleSide,
  back: THREE.BackSide
};

function vectorsToPositions(points: ReadonlyVector[]): number[] {
  return points.flatMap(point => [point[0]!, point[1]!, point[2]!]);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    const renderable = child as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) material?.dispose();
  });
}

export class GeometryLab {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private readonly controls: OrbitControls;
  private readonly content = new THREE.Group();
  private readonly checker: THREE.CanvasTexture;
  private resizeObserver: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0d14);
    this.scene.fog = new THREE.Fog(0x0a0d14, 28, 65);
    this.scene.add(this.content);
    this.scene.add(new THREE.HemisphereLight(0xcad9ff, 0x182018, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(8, 14, 9);
    this.scene.add(key);

    const grid = new THREE.GridHelper(40, 40, 0x303b52, 0x18202f);
    grid.position.y = -5;
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(2.2);
    axes.position.set(-8, -4.98, 7);
    this.scene.add(axes);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 55;
    this.checker = this.createCheckerTexture();
    this.resetCamera();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.animate();
  }

  resetCamera(): void {
    this.camera.position.set(16, 13, 19);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  clear(): void {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      disposeObject(child);
    }
  }

  addPath(route: Path, color = COLORS.path): void {
    const points = route.getPoints(32);
    this.addLine(points, color, 0.8);
  }

  addLine(points: ReadonlyVector[], color: number, opacity = 1): void {
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vectorsToPositions(points), 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    this.content.add(new THREE.Line(geometry, material));
  }

  addPoints(points: ReadonlyVector[], color: number, size: number): void {
    if (points.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vectorsToPositions(points), 3));
    const material = new THREE.PointsMaterial({ color, size, sizeAttenuation: true });
    this.content.add(new THREE.Points(geometry, material));
  }

  addControlStructure(route: Path): void {
    for (const segment of route.segments) {
      if (segment.type === 'quadratic-bezier') {
        this.addLine([segment.p0, segment.p1, segment.p2], 0x7b8498, 0.55);
        this.addPoints([segment.p1], 0x9ca7bd, 0.13);
      } else if (segment.type === 'cubic-bezier') {
        this.addLine([segment.p0, segment.p1], 0x7b8498, 0.55);
        this.addLine([segment.p2, segment.p3], 0x7b8498, 0.55);
        this.addPoints([segment.p1, segment.p2], 0x9ca7bd, 0.13);
      }
    }
  }

  addMarker(point: ReadonlyVector): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 18, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4777ff, emissiveIntensity: 1.4 })
    );
    mesh.position.set(point[0]!, point[1]!, point[2]!);
    this.content.add(mesh);
  }

  addSampling(raw: ReadonlyVector[], spaced: ReadonlyVector[], inputs: ReadonlyVector[]): void {
    this.addPoints(raw, COLORS.raw, 0.12);
    this.addPoints(spaced, COLORS.spaced, 0.17);
    this.addPoints(inputs, COLORS.input, 0.24);
  }

  addFrames(frames: PathFrames, scale = 0.7): void {
    const stride = Math.max(1, Math.ceil(frames.points.length / 28));
    for (let i = 0; i < frames.points.length; i += stride) {
      const point = frames.points[i]!;
      this.addVector(point, frames.tangents[i]!, COLORS.tangent, scale);
      this.addVector(point, frames.normals[i]!, COLORS.normal, scale);
      this.addVector(point, frames.binormals[i]!, COLORS.binormal, scale);
    }
    const sharpPoints = frames.points.filter((_, index) => frames.sharps[index]);
    this.addPoints(sharpPoints, COLORS.sharp, 0.25);
  }

  private addVector(origin: ReadonlyVector, vector: ReadonlyVector, color: number, scale: number): void {
    const end: ReadonlyVector = [
      origin[0]! + vector[0]! * scale,
      origin[1]! + vector[1]! * scale,
      origin[2]! + vector[2]! * scale
    ];
    this.addLine([origin, end], color);
  }

  addMesh(data: GeometryData, options: { wireframe: boolean; normals: boolean; side: MaterialSide }): THREE.Mesh {
    const geometry = createThreeGeometry(data);
    const material = new THREE.MeshStandardMaterial({
      color: 0x90aefc,
      map: this.checker,
      roughness: 0.56,
      metalness: 0.08,
      side: MATERIAL_SIDES[options.side],
      wireframe: options.wireframe
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.content.add(mesh);
    if (options.normals) this.content.add(new VertexNormalsHelper(mesh, 0.32, 0x72f2a7));
    return mesh;
  }

  private createCheckerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        context.fillStyle = (x + y) % 2 === 0 ? '#afc5ff' : '#4c6fb8';
        context.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
