import type { AnchorMode } from "../types";

const STORAGE_KEY = "re0choice.anchor.v1";

export type SavedAnchorPrefs = {
  mode: "live" | "history";
  date: string;
  hour: number;
};

export function loadAnchorPrefs(): SavedAnchorPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedAnchorPrefs;
    if (p.mode !== "live" && p.mode !== "history") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return null;
    if (!Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveAnchorPrefs(prefs: SavedAnchorPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function prefsToAnchor(prefs: SavedAnchorPrefs): AnchorMode {
  if (prefs.mode === "history") {
    return { mode: "history", date: prefs.date, hour: prefs.hour };
  }
  return { mode: "live" };
}

export function initialAnchorState(): {
  anchor: AnchorMode;
  anchorDate: string;
  anchorHour: number;
} {
  const saved = loadAnchorPrefs();
  if (saved) {
    return {
      anchor: prefsToAnchor(saved),
      anchorDate: saved.date,
      anchorHour: saved.hour,
    };
  }
  return {
    anchor: { mode: "live" },
    anchorDate: "",
    anchorHour: 11,
  };
}
