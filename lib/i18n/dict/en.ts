import type { Dict } from "../core";
import { common } from "./common.en";
import { main } from "./main.en";
import { settings } from "./settings.en";

// One file per part of the app; the check script (scripts/i18n-check.mjs) reads them all.
export const en: Dict = { ...common, ...settings, ...main };
