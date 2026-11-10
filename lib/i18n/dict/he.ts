import type { Dict } from "../core";
import { common } from "./common.he";
import { main } from "./main.he";
import { settings } from "./settings.he";

// One file per part of the app; the check script (scripts/i18n-check.mjs) reads them all.
export const he: Dict = { ...common, ...settings, ...main };
