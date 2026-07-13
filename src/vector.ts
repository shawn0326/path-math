export type Vector3 = number[];
export type ReadonlyVector = readonly number[];

function create(): Vector3 {
  return [0, 0, 0];
}

function fromValues(x: number, y: number, z: number): Vector3 {
  return [x, y, z];
}

function clone(a: ReadonlyVector): Vector3 {
  return [a[0]!, a[1]!, a[2]!];
}

function copy(out: Vector3, a: ReadonlyVector): Vector3 {
  out[0] = a[0]!;
  out[1] = a[1]!;
  out[2] = a[2]!;
  return out;
}

function set(out: Vector3, x: number, y: number, z: number): Vector3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

function add(out: Vector3, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  out[0] = a[0]! + b[0]!;
  out[1] = a[1]! + b[1]!;
  out[2] = a[2]! + b[2]!;
  return out;
}

function sub(out: Vector3, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  out[0] = a[0]! - b[0]!;
  out[1] = a[1]! - b[1]!;
  out[2] = a[2]! - b[2]!;
  return out;
}

function scale(out: Vector3, a: ReadonlyVector, value: number): Vector3 {
  out[0] = a[0]! * value;
  out[1] = a[1]! * value;
  out[2] = a[2]! * value;
  return out;
}

function scaleAndAdd(out: Vector3, a: ReadonlyVector, b: ReadonlyVector, scaleValue: number): Vector3 {
  out[0] = a[0]! + b[0]! * scaleValue;
  out[1] = a[1]! + b[1]! * scaleValue;
  out[2] = a[2]! + b[2]! * scaleValue;
  return out;
}

function squaredLength(a: ReadonlyVector): number {
  return a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!;
}

function length(a: ReadonlyVector): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}

function distance(a: ReadonlyVector, b: ReadonlyVector): number {
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
}

function normalize(out: Vector3, a: ReadonlyVector): Vector3 {
  const lengthValue = length(a);
  if (lengthValue > 0) {
    const inverseLength = 1 / lengthValue;
    out[0] = a[0]! * inverseLength;
    out[1] = a[1]! * inverseLength;
    out[2] = a[2]! * inverseLength;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}

function dot(a: ReadonlyVector, b: ReadonlyVector): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function cross(out: Vector3, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  const ax = a[0]!;
  const ay = a[1]!;
  const az = a[2]!;
  const bx = b[0]!;
  const by = b[1]!;
  const bz = b[2]!;

  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export const vec3 = {
  create,
  fromValues,
  clone,
  copy,
  set,
  add,
  sub,
  scale,
  scaleAndAdd,
  squaredLength,
  length,
  len: length,
  distance,
  normalize,
  dot,
  cross
};
