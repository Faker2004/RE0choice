import type { RadarItem } from "../types";
import type { TickerCalcInfo } from "./radarCalc";
import { batchCalcRadarRows, type CalcRowInput } from "./radarCalc";

type WorkerJob = CalcRowInput & { dirKey: "up" | "down" };

let worker: Worker | null = null;
let workerFailed = false;

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("../workers/radarWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

function runOnMainThread(jobs: WorkerJob[]): RadarItem[] {
  return batchCalcRadarRows({ jobs }).items as RadarItem[];
}

const BATCH = 80;

export async function computeRadarItemsInWorker(
  jobs: WorkerJob[],
  dirKey: "up" | "down",
): Promise<RadarItem[]> {
  if (!jobs.length) return [];

  const w = getWorker();
  if (!w) {
    return runOnMainThread(jobs);
  }

  const chunks: WorkerJob[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    chunks.push(jobs.slice(i, i + BATCH));
  }

  const all: RadarItem[] = [];

  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve) => {
          const onMsg = (ev: MessageEvent<{ items: RadarItem[] }>) => {
            w.removeEventListener("message", onMsg);
            w.removeEventListener("error", onErr);
            all.push(...ev.data.items);
            resolve();
          };
          const onErr = () => {
            w.removeEventListener("message", onMsg);
            w.removeEventListener("error", onErr);
            workerFailed = true;
            worker = null;
            all.push(...runOnMainThread(chunk));
            resolve();
          };
          w.addEventListener("message", onMsg);
          w.addEventListener("error", onErr);
          w.postMessage({ jobs: chunk.map((j) => ({ ...j, dirKey })) });
        }),
    ),
  );

  return all;
}

export type { TickerCalcInfo };
