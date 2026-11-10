import type { Dict } from "../core";

// English plural forms only (keys that take {n}).
export const settings: Dict = {
  "{n} people": { one: "{n} person", other: "{n} people" },
  "{n} items": { one: "{n} item", other: "{n} items" },
  "{n} pcs": { one: "{n} pc", other: "{n} pcs" },
  "There is already a front for {n} pieces.": { one: "There is already a front for {n} piece.", other: "There is already a front for {n} pieces." },
};
