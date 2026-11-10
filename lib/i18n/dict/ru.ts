import type { Dict } from "../core";
import { common } from "./common.ru";
import { main } from "./main.ru";
import { settings } from "./settings.ru";

// One file per part of the app; the check script (scripts/i18n-check.mjs) reads them all.
export const ru: Dict = { ...common, ...settings, ...main };
