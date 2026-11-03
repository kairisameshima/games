import * as THREE from 'three';
import { figureGeometry, type CrewMember, type FigureArrays, type FigureDetail } from './figure';
import type { FigureRequest } from './figure-worker';
import { encodeMember } from './member-transfer';

/** Meshing a man takes most of a second, so the crew is meshed off the main thread, several at once. */
const MAX_WORKERS = 4;

interface FigureResponse { id: number; arrays: FigureArrays }

let workers: Worker[] | null = null;
let nextWorker = 0;
let nextRequest = 0;
const pending = new Map<number, (geometry: THREE.BufferGeometry) => void>();

function workerPool(): Worker[] {
  if (workers) return workers;
  const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1));
  workers = Array.from({ length: count }, () => {
    const worker = new Worker(new URL('./figure-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FigureResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(figureGeometry(event.data.arrays));
    };
    return worker;
  });
  return workers;
}

export function meshFigureInWorker(member: CrewMember, detail: FigureDetail): Promise<THREE.BufferGeometry> {
  const pool = workerPool();
  const request: FigureRequest = { id: nextRequest++, member: encodeMember(member), detail };
  return new Promise((resolve) => {
    pending.set(request.id, resolve);
    pool[nextWorker++ % pool.length].postMessage(request);
  });
}
