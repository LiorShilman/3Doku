// Runs OFF the main thread (see pregeneration.ts, which spawns this) -
// generatePuzzleForLevel is a synchronous, CPU-bound function that can take
// anywhere from under a second to over a minute at 10x10 (see the benchmark
// that justified this file existing at all: levels 500-509 ranged from
// 162ms to 62 SECONDS). Running that on the main thread would freeze the
// entire server - every other player's requests, sockets, everything - for
// however long that one call happens to take. A worker thread has its own
// V8 isolate and its own event loop, so the main thread stays responsive no
// matter how long this takes.
import { parentPort, workerData } from 'node:worker_threads';
import { generatePuzzleForLevel } from '@3doku/shared';

interface WorkerInput {
  levelIndex: number;
  excludeRegionsJson: string[];
}

const { levelIndex, excludeRegionsJson } = workerData as WorkerInput;
const exclude = new Set(excludeRegionsJson);
const puzzle = generatePuzzleForLevel(levelIndex, (regions) => exclude.has(JSON.stringify(regions)));
parentPort!.postMessage({ size: puzzle.size, regions: puzzle.regions });
