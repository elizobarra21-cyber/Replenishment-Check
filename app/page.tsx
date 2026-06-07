"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HALL_REQUIRED_SIZES,
  HALL_TARGET_QTY_BY_SIZE,
} from "@/lib/replenishment";

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
  season: string | null;
  storageSection: string | null;
  labelPhotoUrl: string | null;
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

type OcrLine = {
  text: string;
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

type ExtractResponse = {
  article?: string | null;
  parsed?: ParsedLabel | null;
  error?: unknown;
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
  const sectionDelta =
    a.product.section.warehouseOrder - b.product.section.warehouseOrder;
  if (sectionDelta !== 0) {
    return sectionDelta;
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

function groupItemsBySection(items: RequestItem[]) {
  return [...items].sort(compareRequestItems).reduce<WarehouseGroup[]>((acc, item) => {
    const section = item.product.section;
    const existing = acc.find((entry) => entry.sectionId === section.id);
    if (existing) {
      existing.items.push(item);
      return acc;
    }

    acc.push({
      sectionId: section.id,
      sectionName: section.name,
      warehouseOrder: section.warehouseOrder,
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

function findProductByLabelArticle(products: Product[], article: string) {
  if (!article) {
    return undefined;
  }

  const exact = products.find((product) => product.article === article);
  if (exact) {
    return exact;
  }

  const prefixMatches = products
    .filter(
      (product) =>
        article.startsWith(product.article) || product.article.startsWith(article),
    )
    .sort((a, b) => b.article.length - a.article.length);

  return prefixMatches.length === 1 ||
    prefixMatches[0]?.article.length !== prefixMatches[1]?.article.length
    ? prefixMatches[0]
    : undefined;
}

function hasSeventeenDigitLabelCode(text: string) {
  const compact = text.replace(/\D/g, "");
  if (compact.length === 17) {
    return true;
  }

  return /(?:^|\D)\d{17}(?=\D|$)/.test(text);
}

function hasSevenDigitArticle(text: string) {
  return /(?:^|\D)\d{7,}(?=\D|$)/.test(text);
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

function pickCodeLineAboveBarcode(lines: OcrLine[]): string | null {
  const eligible = lines
    .map((line, index) => ({
      text: line.text.trim(),
      index,
      yCenter:
        line.bbox && Number.isFinite(line.bbox.y0) && Number.isFinite(line.bbox.y1)
          ? (line.bbox.y0 + line.bbox.y1) / 2
          : index,
    }))
    .filter((line) => line.text.length > 0)
    .filter((line) => hasSeventeenDigitLabelCode(line.text) || hasSevenDigitArticle(line.text));

  if (eligible.length === 0) {
    return null;
  }

  eligible.sort((a, b) => b.yCenter - a.yCenter);
  return eligible[0].text;
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
  const [products, setProducts] = useState<Product[]>([]);
  const [presentSizesQty, setPresentSizesQty] = useState<SizeQtyMap>({});
  const [draftItems, setDraftItems] = useState<RequestItem[]>([]);
  const [warehouseGroups, setWarehouseGroups] = useState<WarehouseGroup[]>([]);
  const [mode, setMode] = useState<"hall" | "warehouse">("hall");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastParsed, setLastParsed] = useState<ParsedLabel | null>(null);
  const [scannedForCurrentItem, setScannedForCurrentItem] = useState(false);
  const [currentLabelPhotoUrl, setCurrentLabelPhotoUrl] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<{ article: string; url: string } | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [requestRes, bootstrapRes] = await Promise.all([
          fetch("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ createdBy: "telegram-worker" }),
          }),
          fetch("/api/bootstrap"),
        ]);

        const requestJson = await requestRes.json();
        const bootstrapJson = await bootstrapRes.json();

        if (!requestRes.ok || !bootstrapRes.ok) {
          setError("Unable to prepare replenishment request.");
          return;
        }

        setRequestId(requestJson.request.id);
        setProducts(bootstrapJson.products);
      } catch {
        setError("Unable to prepare replenishment request.");
      }
    };

    void bootstrap();
  }, []);

  const selectedProduct = useMemo(
    () => findProductByLabelArticle(products, lastParsed?.article ?? ""),
    [products, lastParsed],
  );

  const selectedOrderedSizes = HALL_REQUIRED_SIZES;

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setPresentSizesQty((prev) => ({ ...prev }));
  }, [selectedProduct]);

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
      const Tesseract = await import("tesseract.js");
      const ocr = await Tesseract.recognize(file, "eng+rus");
      const text = ocr.data.text || "";
      const ocrLines = ((ocr.data as unknown as { lines?: OcrLine[] }).lines ?? []).filter(
        (line) => typeof line.text === "string",
      );
      const barcodeLineText = pickCodeLineAboveBarcode(ocrLines);
      const extractionInputs = barcodeLineText ? [barcodeLineText, text] : [text];

      let extractJson: ExtractResponse | null = null;
      let articleOnlyJson: ExtractResponse | null = null;
      for (const extractionText of extractionInputs) {
        const extractRes = await fetch("/api/label/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: extractionText,
            knownArticles: products.map((product) => product.article),
          }),
        });

        const json = (await extractRes.json()) as ExtractResponse;
        if (extractRes.ok && json.parsed) {
          extractJson = json;
          break;
        }

        if (extractRes.ok && json.article && !articleOnlyJson) {
          articleOnlyJson = json;
        }
      }

      extractJson ??= articleOnlyJson;

      if (!extractJson?.parsed && !extractJson?.article) {
        setCurrentLabelPhotoUrl(null);
        setScannedForCurrentItem(false);
        setError("Could not find the label code above barcode. Try another angle.");
        return;
      }

      const photoUrl = await photoUrlPromise;
      setCurrentLabelPhotoUrl(photoUrl || null);
      setLastParsed(
        extractJson.parsed
          ? {
              ...extractJson.parsed,
              rawLine: composeParsedRawLine(extractJson.parsed),
            }
          : createEmptyParsedLabel(String(extractJson.article)),
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
    if (!requestId || !selectedProduct || !lastParsed) {
      setError("Article is not in catalog. Scan another label.");
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
      setCurrentLabelPhotoUrl(null);
      setPresentSizesQty({});
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
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  {([
                    ["article", parsedForFields.article],
                    ["color", parsedForFields.color],
                    ["season", parsedForFields.season],
                    ["storage", parsedForFields.storageSection],
                  ] as const).map(([label, value]) => (
                    <label
                      key={label}
                      className="text-xs font-semibold uppercase tracking-wide text-black/55"
                    >
                      <span>{label}</span>
                      <input
                        value={value}
                        inputMode="numeric"
                        onChange={(event) => {
                          const nextValue = event.target.value.replace(/\D/g, "");
                          if (label === "article") {
                            updateParsedField("article", nextValue.slice(0, 7));
                          } else if (label === "color") {
                            updateParsedField("color", nextValue.slice(0, 3));
                          } else if (label === "season") {
                            updateParsedField("season", nextValue.slice(0, 1));
                          } else {
                            updateParsedField("storageSection", nextValue.slice(0, 4));
                          }
                        }}
                        maxLength={
                          label === "article"
                            ? 7
                            : label === "storage"
                              ? 4
                              : label === "color"
                                ? 3
                                : 1
                        }
                        className="mt-1 w-full rounded-lg border border-black/10 bg-background px-2 py-2 text-sm font-semibold text-black outline-none ring-0 focus:border-accent"
                      />
                    </label>
                  ))}
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
                disabled={busy || !selectedProduct || !lastParsed}
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
                            className="grid grid-cols-[minmax(0,1fr)_minmax(120px,auto)] gap-3 rounded-lg bg-background px-3 py-2 text-sm"
                          >
                            <span className="truncate font-semibold">{item.article}</span>
                            <span className="text-right text-black/70">
                              {formatSizeMap(
                                item.presentSizesQty,
                                item.product.sizeSystem.orderedSizes,
                              )}
                            </span>
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
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-semibold">{group.sectionName}</h3>
                      <span className="text-xs font-semibold text-black/45">
                        Order {group.warehouseOrder}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {group.items.map((item) => (
                        <article key={item.id} className="rounded-lg bg-background px-3 py-3">
                          <div className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
                                article
                              </p>
                              <button
                                type="button"
                                onClick={() => openScanPhoto(item)}
                                title={item.labelPhotoUrl ? "Open scan photo" : "No scan photo saved"}
                                className="mt-1 text-left text-base font-semibold text-accent underline decoration-accent/40 underline-offset-4"
                              >
                                {item.article}
                              </button>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
                                color
                              </p>
                              <p className="mt-1 text-sm font-semibold">
                                {formatLabelPart(item.color)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
                                season
                              </p>
                              <p className="mt-1 text-sm font-semibold">
                                {formatLabelPart(item.season)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
                                needed sizes
                              </p>
                              <p className="mt-1 text-sm font-semibold">
                                {formatSizeMap(
                                  item.neededSizesQty,
                                  item.product.sizeSystem.orderedSizes,
                                )}
                              </p>
                            </div>
                            <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
                                present sizes (reference)
                              </p>
                              <p className="mt-1 text-sm font-semibold">
                                {formatSizeMap(
                                  item.presentSizesQty,
                                  item.product.sizeSystem.orderedSizes,
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/60">
                            <span>{item.product.name}</span>
                            <span>Storage {formatLabelPart(item.storageSection)}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
