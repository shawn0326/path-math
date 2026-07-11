import * as THREE from 'three';
import type { GeometryData } from 'path-geometry';

function assertFinite(name: string, values: number[]): void {
  const invalidIndex = values.findIndex(value => !Number.isFinite(value));
  if (invalidIndex >= 0) {
    throw new Error(`${name}[${invalidIndex}] is not a finite number.`);
  }
}

export function validateGeometryData(data: GeometryData): void {
  if (data.positions.length === 0 || data.indices.length === 0) {
    throw new Error('The geometry builder returned an empty mesh.');
  }
  if (data.positions.length % 3 !== 0 || data.normals.length !== data.positions.length) {
    throw new Error('Position and normal buffers have incompatible lengths.');
  }
  const vertexCount = data.positions.length / 3;
  if (data.uvs.length !== vertexCount * 2 || data.uvs2.length !== vertexCount * 2) {
    throw new Error('UV buffers do not match the vertex count.');
  }
  if (data.indices.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    throw new Error('The index buffer references a missing vertex.');
  }
  assertFinite('positions', data.positions);
  assertFinite('normals', data.normals);
  assertFinite('uvs', data.uvs);
  assertFinite('uvs2', data.uvs2);
}

export function createThreeGeometry(data: GeometryData): THREE.BufferGeometry {
  validateGeometryData(data);

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  result.setAttribute('uv1', new THREE.Float32BufferAttribute(data.uvs2, 2));
  result.setIndex(data.indices);
  result.computeBoundingSphere();
  return result;
}
