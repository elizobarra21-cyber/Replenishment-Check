"use client";

import { useEffect, useState } from "react";

// A thin animated bar at the top of the screen while any request to the server
// is in flight, so the app never looks frozen. It appears only after a short
// delay, so quick requests don't flicker.
const SHOW_AFTER_MS = 250;

let pending = 0;
const listeners = new Set<(count: number) => void>();
let patched = false;

function notify() {
  for (const listener of listeners) listener(pending);
}

function patchFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    pending += 1;
    notify();
    try {
      return await original(...args);
    } finally {
      pending -= 1;
      notify();
    }
  };
}

export function ActivityBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    patchFetch();
    let timer: number | undefined;
    const onChange = (count: number) => {
      window.clearTimeout(timer);
      if (count > 0) {
        timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
      } else {
        setVisible(false);
      }
    };
    listeners.add(onChange);
    onChange(pending);
    return () => {
      listeners.delete(onChange);
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px] overflow-hidden bg-accent/10"
    >
      <div className="activity-bar h-full w-1/3 bg-accent" />
    </div>
  );
}
