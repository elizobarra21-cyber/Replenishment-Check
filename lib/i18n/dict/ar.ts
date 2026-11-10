import type { Dict } from "../core";
import { common } from "./common.ar";
import { main } from "./main.ar";
import { settings } from "./settings.ar";

// One file per part of the app; the check script (scripts/i18n-check.mjs) reads them all.
export const ar: Dict = { ...common, ...settings, ...main };
