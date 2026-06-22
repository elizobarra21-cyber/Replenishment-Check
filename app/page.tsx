"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HALL_REQUIRED_SIZES,
  HALL_TARGET_QTY_BY_SIZE,
} from "@/lib/replenishment";
import {
  extractArticleFromLabel,
  type LabelExtractionResult,
} from "@/lib/label-extractor";
import { readLabelCandidates, terminateOcr, warmUpOcr } from "@/lib/ocr";
import { COMMON_COLORS, isHexColor, resolveColor } from "@/lib/colors";

type SizeQtyMap = Record<string, number>;

type Product = {
  id: string;
  article: string;
  name: string;
  section: { id: string; name: string; warehouseOrder: number };
  sizeSystem: {
    id: string;
    name: string;
    orderedSizes: string[];
    targetQtyBySize: SizeQtyMap;
  };
};

type RequestItem = {
  id: string;
  article: string;
  color: string | null;
  colorName?: string | null;
  season: string | null;
  storageSection: string | null;
  labelPhotoUrl: string | null;
  pickStatus?: string | null;
  presentSizesQty: SizeQtyMap;
  neededSizesQty: SizeQtyMap;
  substitutePriority: string[];
  product: Product;
};

type WarehouseGroup = {
  sectionId: string;
  sectionName: string;
  warehouseOrder: number;
  items: RequestItem[];
};

type ParsedLabel = {
  rawLine: string;
  article: string;
  color: string;
  ignoredDigits: string;
  season: string;
  storageSection: string;
};

function orderedSizeKeys(map: SizeQtyMap, orderedSizes: string[] = []) {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const size of orderedSizes) {
    if (Object.prototype.hasOwnProperty.call(map, size)) {
      keys.push(size);
      seen.add(size);
    }
  }

  for (const size of Object.keys(map)) {
    if (!seen.has(size)) {
      keys.push(size);
    }
  }

  return keys;
}

function formatSizeMap(map: SizeQtyMap, orderedSizes: string[] = []) {
  const chunks = orderedSizeKeys(map, orderedSizes)
    .map((size) => [size, Number(map[size] ?? 0)] as const)
    .filter(([, qty]) => qty > 0)
    .map(([size, qty]) => `${size} x${qty}`);

  return chunks.length ? chunks.join(", ") : "-";
}

function explodeSizeMap(map: SizeQtyMap, orderedSizes: string[] = []) {
  return orderedSizeKeys(map, orderedSizes).flatMap((size) =>
    Array.from({ length: Math.max(0, Number(map[size]) || 0) }, () => size),
  );
}

function compareLabelField(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return (left ?? "").localeCompare(right ?? "", "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareRequestItems(a: RequestItem, b: RequestItem) {
  const sectionDelta = storageOrder(a.storageSection) - storageOrder(b.storageSection);
  if (sectionDelta !== 0) {
    return sectionDelta;
  }

  const storageDelta = compareLabelField(a.storageSection, b.storageSection);
  if (storageDelta !== 0) {
    return storageDelta;
  }

  const articleDelta = compareLabelField(a.article, b.article);
  if (articleDelta !== 0) {
    return articleDelta;
  }

  const seasonDelta = compareLabelField(a.season, b.season);
  if (seasonDelta !== 0) {
    return seasonDelta;
  }

  return compareLabelField(a.color, b.color);
}

function storageOrder(storageSection: string | null | undefined) {
  const order = Number(storageSection);
  return Number.isInteger(order) && order > 0 ? order : 9999;
}

function storageGroupId(storageSection: string | null | undefined) {
  const normalized = storageSection?.trim();
  return normalized ? `storage-${normalized}` : "storage-unassigned";
}

function storageGroupName(storageSection: string | null | undefined) {
  const normalized = storageSection?.trim();
  return normalized ? `Department ${normalized}` : "No department";
}

function groupItemsBySection(items: RequestItem[]) {
  return [...items].sort(compareRequestItems).reduce<WarehouseGroup[]>((acc, item) => {
    const sectionId = storageGroupId(item.storageSection);
    const existing = acc.find((entry) => entry.sectionId === sectionId);
    if (existing) {
      existing.items.push(item);
      return acc;
    }

    acc.push({
      sectionId,
      sectionName: storageGroupName(item.storageSection),
      warehouseOrder: storageOrder(item.storageSection),
      items: [item],
    });

    return acc;
  }, []);
}

function formatLabelPart(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "-";
}

function errorMessage(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

const REQUEST_STORAGE_KEY = "store-replenishment:request-id";

function loadStoredRequestId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(REQUEST_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeRequestId(id: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(REQUEST_STORAGE_KEY, id);
  } catch {
    // ignore storage errors (private mode, quota)
  }
}

function clearStoredRequestId() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const MODE_STORAGE_KEY = "store-replenishment:mode";

function loadStoredMode(): "hall" | "warehouse" | "" {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    return value === "warehouse" || value === "hall" ? value : "";
  } catch {
    return "";
  }
}

function storeMode(mode: "hall" | "warehouse") {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function createEmptyParsedLabel(article = ""): ParsedLabel {
  return {
    rawLine: article,
    article,
    color: "",
    ignoredDigits: "",
    season: "",
    storageSection: "",
  };
}

function ColorSwatch({ value, size = 14 }: { value: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full border border-black/20 align-middle"
      style={{ width: size, height: size, backgroundColor: resolveColor(value).hex }}
    />
  );
}

function SizeTiles({
  map,
  orderedSizes,
  variant,
}: {
  map: SizeQtyMap;
  orderedSizes: string[];
  variant: "need" | "present";
}) {
  const tokens = explodeSizeMap(map, orderedSizes);
  if (!tokens.length) {
    return <span className="text-sm text-black/35">-</span>;
  }

  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {tokens.map((size, index) => (
        <span
          key={`${size}-${index}`}
          className={
            variant === "need"
              ? "inline-flex min-w-7 justify-center rounded-md bg-accent px-1.5 py-1 text-xs font-bold text-white"
              : "inline-flex min-w-7 justify-center rounded-md border border-black/15 bg-white px-1.5 py-1 text-xs font-semibold text-black/55"
          }
        >
          {size}
        </span>
      ))}
    </span>
  );
}

function composeParsedRawLine(parsed: ParsedLabel) {
  return [
    parsed.article,
    parsed.color,
    parsed.ignoredDigits,
    parsed.season,
    parsed.storageSection,
  ]
    .filter(Boolean)
    .join(" ");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read scan photo"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load scan photo"));
    image.src = src;
  });
}

async function createLabelPhotoUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);

  try {
    const image = await loadImage(dataUrl);
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return dataUrl;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.74);
  } catch {
    return dataUrl;
  }
}

export default function Home() {
  const [requestId, setRequestId] = useState("");
  const [presentSizesQty, setPresentSizesQty] = useState<SizeQtyMap>({});
  const [draftItems, setDraftItems] = useState<RequestItem[]>([]);
  const [warehouseGroups, setWarehouseGroups] = useState<WarehouseGroup[]>([]);
  const [mode, setMode] = useState<"hall" | "warehouse">("hall");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastParsed, setLastParsed] = useState<ParsedLabel | null>(null);
  const [colorValue, setColorValue] = useState("");
  const [scannedForCurrentItem, setScannedForCurrentItem] = useState(false);
  const [currentLabelPhotoUrl, setCurrentLabelPhotoUrl] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<{ article: string; url: string } | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");

  useEffect(() => {
    const createRequest = async () => {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createdBy: "telegram-worker" }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error("Unable to create request");
      }
      storeRequestId(json.request.id);
      setRequestId(json.request.id);
    };

    const bootstrap = async () => {
      // Resume the saved request so the in-progress list survives page reloads
      // and dropped connections. It is cleared only via "Finish replenishment".
      const storedId = loadStoredRequestId();
      const storedMode = loadStoredMode();
      if (storedId) {
        try {
          const res = await fetch(`/api/requests/${storedId}`);
          if (res.ok) {
            const json = await res.json();
            setRequestId(storedId);
            setDraftItems((json.request?.items ?? []) as RequestItem[]);
            // Stay in whichever mode the worker left off in.
            if (storedMode === "warehouse") {
              try {
                const wres = await fetch(`/api/requests/${storedId}/warehouse`);
                const wjson = await wres.json();
                if (wres.ok) {
                  setWarehouseGroups(wjson.grouped as WarehouseGroup[]);
                  setMode("warehouse");
                }
              } catch {
                // fall back to hall if the warehouse view can't load
              }
            }
            return;
          }
          if (res.status !== 404) {
            // Server reachable but errored - keep the id and reuse it.
            setRequestId(storedId);
            setError("Could not load the saved list. Refresh to retry.");
            return;
          }
          // 404: the request no longer exists, start a fresh one below.
          clearStoredRequestId();
        } catch {
          // Offline / network error - keep the id so adds still target it and
          // the list reloads once the connection is back.
          setRequestId(storedId);
          setError("Offline? The saved list reloads when the connection returns.");
          return;
        }
      }

      await createRequest();
    };

    bootstrap().catch(() => setError("Unable to prepare replenishment request."));
  }, []);

  useEffect(() => {
    // Remember the current mode so a reload returns to it.
    storeMode(mode);
  }, [mode]);

  useEffect(() => {
    // Prepare the OCR worker ahead of time so the first scan does not pay the
    // worker setup cost. Reused across every scan; torn down on unmount.
    warmUpOcr();
    return () => {
      void terminateOcr();
    };
  }, []);

  const selectedOrderedSizes = HALL_REQUIRED_SIZES;

  const neededPreview = useMemo(() => {
    return HALL_REQUIRED_SIZES.reduce<SizeQtyMap>((acc, size) => {
      const target = HALL_TARGET_QTY_BY_SIZE[size] ?? 1;
      const current = presentSizesQty[size] ?? 0;
      if (target > current) {
        acc[size] = target - current;
      }
      return acc;
    }, {});
  }, [presentSizesQty]);

  const presentSizeTokens = useMemo(
    () => explodeSizeMap(presentSizesQty, selectedOrderedSizes),
    [presentSizesQty, selectedOrderedSizes],
  );

  const neededSizeTokens = useMemo(
    () => explodeSizeMap(neededPreview, selectedOrderedSizes),
    [neededPreview, selectedOrderedSizes],
  );

  const hallBriefGroups = useMemo(
    () => groupItemsBySection(draftItems),
    [draftItems],
  );
  const parsedForFields = lastParsed ?? createEmptyParsedLabel();

  function updateParsedField(
    field: "article" | "color" | "season" | "storageSection",
    value: string,
  ) {
    setLastParsed((prev) => {
      const next = {
        ...(prev ?? createEmptyParsedLabel()),
        [field]: value,
      };
      next.rawLine = composeParsedRawLine(next);
      return next;
    });
  }

  async function handleScanLabel(file: File | null) {
    if (!file) {
      return;
    }

    setError("");
    setPhotoNotice("");
    setScanBusy(true);

    const photoUrlPromise = createLabelPhotoUrl(file).catch(() => "");

    try {
      const candidates = await readLabelCandidates(file);

      let extracted: LabelExtractionResult | null = null;
      let articleOnly: LabelExtractionResult | null = null;
      for (const candidate of candidates) {
        const result = extractArticleFromLabel(candidate);
        if (result.parsed) {
          extracted = result;
          break;
        }
        if (result.article && !articleOnly) {
          articleOnly = result;
        }
      }

      extracted ??= articleOnly;

      if (!extracted?.parsed && !extracted?.article) {
        setCurrentLabelPhotoUrl(null);
        setScannedForCurrentItem(false);
        setError("Could not find the label code above barcode. Try another angle.");
        return;
      }

      const photoUrl = await photoUrlPromise;
      setCurrentLabelPhotoUrl(photoUrl || null);
      setLastParsed(
        extracted.parsed
          ? {
              ...extracted.parsed,
              rawLine: composeParsedRawLine(extracted.parsed),
            }
          : createEmptyParsedLabel(String(extracted.article)),
      );
      setScannedForCurrentItem(true);
    } catch {
      setCurrentLabelPhotoUrl(null);
      setScannedForCurrentItem(false);
      setError("Scan failed. Please retry with clearer photo and light.");
    } finally {
      setScanBusy(false);
    }
  }

  async function handleAddItem() {
    if (!requestId || !lastParsed?.article) {
      setError("Scan the code or enter article before adding to warehouse list.");
      return;
    }

    setError("");
    setPhotoNotice("");
    setBusy(true);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          article: lastParsed.article,
          color: lastParsed.color,
          colorName: colorValue,
          season: lastParsed.season,
          storageSection: lastParsed.storageSection,
          labelPhotoUrl: currentLabelPhotoUrl ?? "",
          presentSizesQty,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(errorMessage(json.error, "Failed to save scan"));
        return;
      }

      setDraftItems((prev) => [...prev, json.item as RequestItem]);
      setScannedForCurrentItem(false);
      setLastParsed(null);
      setColorValue("");
      setCurrentLabelPhotoUrl(null);
      setPresentSizesQty({});

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Failed to save scan");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoWarehouse() {
    if (!requestId) {
      return;
    }

    setError("");
    setPhotoNotice("");
    setBusy(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/warehouse`);
      const json = await res.json();

      if (!res.ok) {
        setError(errorMessage(json.error, "Unable to build warehouse list"));
        return;
      }

      setWarehouseGroups(json.grouped as WarehouseGroup[]);
      setMode("warehouse");
    } catch {
      setError("Unable to build warehouse list");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishReplenishment() {
    if (!requestId) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm("Finish replenishment and clear the current list?")
    ) {
      return;
    }

    setError("");
    setPhotoNotice("");
    setBusy(true);

    const finishedId = requestId;

    try {
      // Mark the finished request as done (best effort - the new request is
      // what matters for continued work).
      await fetch(`/api/requests/${finishedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }).catch(() => {});

      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createdBy: "telegram-worker" }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError("Unable to start a new replenishment.");
        return;
      }

      storeRequestId(json.request.id);
      setRequestId(json.request.id);

      setDraftItems([]);
      setWarehouseGroups([]);
      setPresentSizesQty({});
      setLastParsed(null);
      setColorValue("");
      setCurrentLabelPhotoUrl(null);
      setScannedForCurrentItem(false);
      setMode("hall");
    } catch {
      setError("Unable to finish replenishment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPickStatus(item: RequestItem, status: "taken" | "absent") {
    const next = item.pickStatus === status ? null : status;
    const previous = item.pickStatus ?? null;

    const apply = (value: string | null) =>
      setWarehouseGroups((groups) =>
        groups.map((group) => ({
          ...group,
          items: group.items.map((entry) =>
            entry.id === item.id ? { ...entry, pickStatus: value } : entry,
          ),
        })),
      );

    apply(next); // optimistic update for a snappy tap

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickStatus: next }),
      });
      if (!res.ok) {
        throw new Error("Unable to save pick status");
      }
    } catch {
      apply(previous); // revert if the server did not accept it
      setError("Could not save the mark. Check connection and retry.");
    }
  }

  function openScanPhoto(item: RequestItem) {
    setPhotoNotice("");

    if (!item.labelPhotoUrl) {
      setPhotoViewer(null);
      setPhotoNotice(`No scan photo saved for article ${item.article}.`);
      return;
    }

    setPhotoViewer({ article: item.article, url: item.labelPhotoUrl });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-4 md:p-8">
      {photoViewer ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Scan photo for article ${photoViewer.article}`}
          onClick={() => setPhotoViewer(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Scan photo: {photoViewer.article}</h2>
              <button
                type="button"
                onClick={() => setPhotoViewer(null)}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <img
              src={photoViewer.url}
              alt={`Scanned label for article ${photoViewer.article}`}
              className="max-h-[75vh] w-full rounded-xl bg-background object-contain"
            />
          </div>
        </div>
      ) : null}

      <header className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">
          Store replenishment
        </p>
        <h1 className="mt-2 text-2xl font-bold md:text-4xl">
          Hall scan and warehouse picking
        </h1>
      </header>

      <main className="mt-5 space-y-4">
        {mode === "hall" ? (
          <>
            <section className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">Hall mode</h2>
                <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
                  {requestId ? "Request ready" : "Preparing"}
                </span>
              </div>

              <div className="rounded-xl border border-black/10 bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-black/60">
                  Label scanner
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white">
                    {scanBusy ? "Scanning..." : "Scan from camera"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={scanBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void handleScanLabel(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>

                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-accent bg-white px-3 py-2 text-sm font-semibold text-accent">
                    {scanBusy ? "Scanning..." : "Scan from gallery"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={scanBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void handleScanLabel(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-white px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                  Last parsed code
                </p>
                <p className="mt-1 text-sm font-semibold text-accent">
                  {lastParsed?.rawLine || "-"}
                </p>
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-black/55">
                    <span>article</span>
                    <input
                      value={parsedForFields.article}
                      inputMode="numeric"
                      onChange={(event) =>
                        updateParsedField(
                          "article",
                          event.target.value.replace(/\D/g, "").slice(0, 7),
                        )
                      }
                      maxLength={7}
                      className="mt-1 w-full rounded-lg border border-black/10 bg-background px-2 py-2 text-sm font-semibold text-black outline-none ring-0 focus:border-accent"
                    />
                  </label>

                  <div className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    <span>color</span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <input
                        value={parsedForFields.color}
                        inputMode="numeric"
                        aria-label="color code"
                        onChange={(event) =>
                          updateParsedField(
                            "color",
                            event.target.value.replace(/\D/g, "").slice(0, 3),
                          )
                        }
                        maxLength={3}
                        className="w-16 rounded-lg border border-black/10 bg-background px-2 py-2 text-sm font-semibold text-black outline-none ring-0 focus:border-accent"
                      />
                      {COMMON_COLORS.map((swatch) => {
                        const selected = colorValue.toLowerCase() === swatch.name;
                        return (
                          <button
                            key={swatch.name}
                            type="button"
                            onClick={() => setColorValue(selected ? "" : swatch.name)}
                            aria-label={swatch.label}
                            aria-pressed={selected}
                            title={swatch.label}
                            className={`h-7 w-7 rounded-full border transition-transform active:scale-90 ${
                              selected
                                ? "border-accent ring-2 ring-accent/40 ring-offset-1"
                                : "border-black/15"
                            }`}
                            style={{ backgroundColor: swatch.hex }}
                          />
                        );
                      })}

                      <label
                        title="Pick any color from the spectrum"
                        aria-label="Pick any color from the spectrum"
                        className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border active:scale-90 ${
                          isHexColor(colorValue)
                            ? "border-accent ring-2 ring-accent/40 ring-offset-1"
                            : "border-black/15"
                        }`}
                        style={{
                          background: isHexColor(colorValue)
                            ? colorValue
                            : "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                        }}
                      >
                        <input
                          type="color"
                          value={isHexColor(colorValue) ? colorValue : "#3366ff"}
                          onChange={(event) => setColorValue(event.target.value)}
                          className="sr-only"
                        />
                      </label>

                      {colorValue ? (
                        <button
                          type="button"
                          onClick={() => setColorValue("")}
                          aria-label="Clear color"
                          title="Clear color"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/15 text-base leading-none text-black/45 active:scale-90"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-black/55">
                      <span>season</span>
                      <input
                        value={parsedForFields.season}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateParsedField(
                            "season",
                            event.target.value.replace(/\D/g, "").slice(0, 1),
                          )
                        }
                        maxLength={1}
                        className="mt-1 w-full rounded-lg border border-black/10 bg-background px-2 py-2 text-sm font-semibold text-black outline-none ring-0 focus:border-accent"
                      />
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-black/55">
                      <span>storage</span>
                      <input
                        value={parsedForFields.storageSection}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateParsedField(
                            "storageSection",
                            event.target.value.replace(/\D/g, "").slice(0, 4),
                          )
                        }
                        maxLength={4}
                        className="mt-1 w-full rounded-lg border border-black/10 bg-background px-2 py-2 text-sm font-semibold text-black outline-none ring-0 focus:border-accent"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                  Choose existing sizes
                </p>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {HALL_REQUIRED_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setPresentSizesQty((prev) => ({
                          ...prev,
                          [size]: (prev[size] ?? 0) + 1,
                        }));
                      }}
                      className="min-h-14 rounded-xl border border-accent bg-accent-soft px-3 py-3 text-center transition-colors active:scale-[0.97]"
                    >
                      <span className="text-sm font-semibold text-accent">{size}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex min-h-8 flex-wrap gap-1.5">
                  {presentSizeTokens.length ? (
                    presentSizeTokens.map((token, index) => (
                      <button
                        key={`${token}-${index}`}
                        type="button"
                        onClick={() => {
                          setPresentSizesQty((prev) => ({
                            ...prev,
                            [token]: Math.max(0, (prev[token] ?? 0) - 1),
                          }));
                        }}
                        className="rounded-md bg-background px-2.5 py-1.5 text-sm font-semibold active:scale-[0.97]"
                        title="Remove one"
                      >
                        {token}
                      </button>
                    ))
                  ) : (
                    <span className="text-sm text-black/55">-</span>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                  Suggested sizes
                </p>
                <div className="mt-2 flex min-h-8 flex-wrap gap-1.5">
                  {neededSizeTokens.length ? (
                    neededSizeTokens.map((token, index) => (
                      <span
                        key={`need-${token}-${index}`}
                        className="rounded-md bg-accent-soft px-2.5 py-1.5 text-sm font-semibold text-accent"
                      >
                        {token}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-black/60">-</span>
                  )}
                </div>
              </div>

              {error ? (
                <div className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm">
                  {error}
                </div>
              ) : null}

              <button
                onClick={() => void handleAddItem()}
                disabled={busy || !lastParsed?.article}
                className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Add to list
              </button>

              <button
                onClick={() => void handleGoWarehouse()}
                disabled={busy || draftItems.length === 0}
                className="mt-2 w-full rounded-xl border border-accent bg-white px-4 py-3 text-sm font-semibold text-accent disabled:opacity-60"
              >
                Go to warehouse
              </button>

              <button
                onClick={() => void handleFinishReplenishment()}
                disabled={busy || draftItems.length === 0}
                className="mt-2 w-full rounded-xl border border-danger/40 bg-white px-4 py-3 text-sm font-semibold text-danger disabled:opacity-60"
              >
                Finish replenishment
              </button>
            </section>

            <section className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold">Warehouse short list</h2>
              {hallBriefGroups.length === 0 ? (
                <p className="text-sm text-black/60">No items added yet.</p>
              ) : (
                <div className="space-y-3">
                  {hallBriefGroups.map((group) => (
                    <div key={group.sectionId} className="rounded-xl border border-black/10 bg-white p-3">
                      <h3 className="text-base font-semibold">{group.sectionName}</h3>
                      <div className="mt-2 space-y-1.5">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg bg-background px-3 py-2 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-semibold">{item.article}</span>
                              <span className="text-right text-black/70">
                                {formatSizeMap(
                                  item.presentSizesQty,
                                  item.product.sizeSystem.orderedSizes,
                                )}
                              </span>
                            </div>
                            {item.color || item.colorName ? (
                              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-black/55">
                                <span>color {formatLabelPart(item.color)}</span>
                                {item.colorName ? (
                                  <ColorSwatch value={item.colorName} size={12} />
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Warehouse mode</h2>
                <p className="mt-1 text-sm text-black/60">
                  Grouped by department. Sorted by article, season, color.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode("hall");
                  setPhotoNotice("");
                }}
                className="rounded-xl border border-accent bg-white px-3 py-2 text-sm font-semibold text-accent"
              >
                Hall mode
              </button>
            </div>

            {photoNotice ? (
              <div className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm">
                {photoNotice}
              </div>
            ) : null}

            {error ? (
              <div className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm">
                {error}
              </div>
            ) : null}

            {warehouseGroups.length === 0 ? (
              <p className="text-sm text-black/60">No warehouse items.</p>
            ) : (
              <div className="space-y-3">
                {warehouseGroups.map((group) => (
                  <div key={group.sectionId} className="rounded-xl border border-black/10 bg-white p-3">
                    <h3 className="text-sm font-semibold">{group.sectionName}</h3>
                    <div className="mt-1.5 divide-y divide-black/5">
                      {group.items.map((item) => (
                        <article key={item.id} className="py-2 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <button
                              type="button"
                              onClick={() => openScanPhoto(item)}
                              title={item.labelPhotoUrl ? "Open scan photo" : "No scan photo saved"}
                              className={`text-left text-sm font-semibold text-accent underline decoration-accent/40 underline-offset-4 ${
                                item.pickStatus ? "opacity-50 line-through" : ""
                              }`}
                            >
                              {item.article}
                            </button>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                                need
                              </span>
                              <SizeTiles
                                map={item.neededSizesQty}
                                orderedSizes={item.product.sizeSystem.orderedSizes}
                                variant="need"
                              />
                            </div>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/55">
                            <span className="inline-flex items-center gap-1.5">
                              color {formatLabelPart(item.color)}
                              {item.colorName ? <ColorSwatch value={item.colorName} size={12} /> : null}
                            </span>
                            <span>season {formatLabelPart(item.season)}</span>
                            <span className="inline-flex items-center gap-1.5">
                              present
                              <SizeTiles
                                map={item.presentSizesQty}
                                orderedSizes={item.product.sizeSystem.orderedSizes}
                                variant="present"
                              />
                            </span>
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSetPickStatus(item, "taken")}
                              aria-pressed={item.pickStatus === "taken"}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] ${
                                item.pickStatus === "taken"
                                  ? "bg-accent text-white"
                                  : "border border-accent text-accent"
                              }`}
                            >
                              Taken
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSetPickStatus(item, "absent")}
                              aria-pressed={item.pickStatus === "absent"}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] ${
                                item.pickStatus === "absent"
                                  ? "bg-danger text-white"
                                  : "border border-danger/40 text-danger"
                              }`}
                            >
                              Absent
                            </button>
                            {item.pickStatus ? (
                              <span className="text-xs font-semibold text-black/45">
                                {item.pickStatus === "taken" ? "Picked" : "Not in stock"}
                              </span>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => void handleFinishReplenishment()}
              disabled={busy || draftItems.length === 0}
              className="mt-4 w-full rounded-xl border border-danger/40 bg-white px-4 py-3 text-sm font-semibold text-danger disabled:opacity-60"
            >
              Finish replenishment
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
