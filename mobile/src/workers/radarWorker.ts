import { batchCalcRadarRows, type BatchCalcPayload, type BatchCalcResult } from "../lib/radarCalc";

self.onmessage = (ev: MessageEvent<BatchCalcPayload>) => {
  const result: BatchCalcResult = batchCalcRadarRows(ev.data);
  self.postMessage(result);
};

export {};
