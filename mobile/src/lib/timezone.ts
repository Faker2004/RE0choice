/**
 * 北京时间 UTC+8 — 全项目统一 Key 格式：YYYY-MM-DD HH:00:00
 */
const BJ_OFFSET_MS = 8 * 3600_000;
const MA_BARS = 24;
const BJ_KEY_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00:00$/;

export { MA_BARS };

/** 强制规范为 YYYY-MM-DD HH:00:00，读写碰撞唯一格式 */
export function normalizeBjHour(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/);
  if (!m) throw new Error(`非法北京时间 Key: ${raw}`);
  const h = m[4] ?? "00";
  return `${m[1]}-${m[2]}-${m[3]} ${h.padStart(2, "0")}:00:00`;
}

export function bjHourStrFromMs(utcMs: number): string {
  const d = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  let h = get("hour");
  if (h === "24") h = "00";
  return `${y}-${mo}-${da} ${h}:00:00`;
}

export function bjHourStrFromParts(y: number, m: number, d: number, h: number): string {
  return normalizeBjHour(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:00:00`);
}

export function parseBjHour(s: string): { y: number; m: number; d: number; h: number } {
  const norm = normalizeBjHour(s);
  const m = norm.match(BJ_KEY_RE);
  if (!m) throw new Error(`parseBjHour: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), h: Number(m[4]) };
}

export function bjDateStr(offsetDays = 0): string {
  const ms = Date.now() + offsetDays * 86_400_000;
  return bjHourStrFromMs(ms).slice(0, 10);
}

export function bjNowParts(): { y: number; m: number; d: number; h: number } {
  return parseBjHour(bjHourStrFromMs(Date.now()));
}

export function barOpenBjForTarget(date: string, targetHour: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (targetHour <= 0) {
    const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
    return bjHourStrFromParts(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 23);
  }
  return bjHourStrFromParts(y, m, d, targetHour - 1);
}

export function anchorEndLabel(date: string, targetHour: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (targetHour <= 0) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00`;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(targetHour).padStart(2, "0")}:00`;
}

export function resolveLiveOpenBj(): string {
  const { y, m, d, h } = bjNowParts();
  if (h <= 0) {
    const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
    return bjHourStrFromParts(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 23);
  }
  return bjHourStrFromParts(y, m, d, h - 1);
}

export function bjMsFromHourStr(s: string): number {
  const { y, m, d, h } = parseBjHour(normalizeBjHour(s));
  return Date.UTC(y, m - 1, d, h, 0, 0, 0) - BJ_OFFSET_MS;
}

export function addHoursBj(hourStr: string, delta: number): string {
  const ms = bjMsFromHourStr(hourStr) + delta * 3600_000;
  return bjHourStrFromMs(ms);
}

/** 升序枚举 [start, end] 闭区间内每个整点 Key */
export function enumerateBjHours(startBj: string, endBj: string): string[] {
  const start = normalizeBjHour(startBj);
  const end = normalizeBjHour(endBj);
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 500) {
    out.push(cur);
    if (cur === end) break;
    cur = addHoursBj(cur, 1);
  }
  return out;
}

export function expectedBarCount(startBj: string, endBj: string): number {
  return enumerateBjHours(startBj, endBj).length;
}
