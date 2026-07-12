"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HALL_REQUIRED_SIZES,
  ALL_SIZE_SYSTEMS,
  buildTargetSizes,
  categoryOf,
  genderOf,
  optionalSizesFor,
  presentTotal,
  resolveSizeSystem,
  selectableSizesFor,
  sizeSystemFromParts,
  targetTotal,
  type Gender,
  type SizeCategory,
  type SizeSystem,
} from "@/lib/replenishment";
import {
  extractArticleFromLabel,
  type LabelExtractionResult,
} from "@/lib/label-extractor";
import {
  beginScan,
  detectSizeToken,
  readLabelCandidates,
  terminateOcr,
  warmUpOcr,
} from "@/lib/ocr";
import { COMMON_COLORS, isHexColor, resolveColor } from "@/lib/colors";

type SizeQtyMap = Record<string, number>;

const LETTER_SIZES = HALL_REQUIRED_SIZES;

// Labels for the manual size-grid picker.
const CATEGORY_LABELS: Array<{ value: SizeCategory; label: string }> = [
  { value: "letter", label: "Letter" },
  { value: "small", label: "Jeans" },
  { value: "large", label: "Numeric" },
];

// Best-effort size system for an already-saved item (older items may lack it).
function itemSizeSystem(item: RequestItem): SizeSystem {
  if (item.sizeSystem && ALL_SIZE_SYSTEMS.includes(item.sizeSystem as SizeSystem)) {
    return item.sizeSystem as SizeSystem;
  }
  const keys = [
    ...Object.keys(item.presentSizesQty ?? {}),
    ...Object.keys(item.neededSizesQty ?? {}),
  ];
  if (keys.some((k) => /^\d+$/.test(k) && Number(k) >= 34)) return "large";
  if (keys.some((k) => /^\d+$/.test(k) && Number(k) >= 24 && Number(k) <= 33)) return "small";
  return "letter";
}

// Total expected to hang (Y) for a saved item.
function itemTargetCount(item: RequestItem): number {
  return targetTotal(buildTargetSizes(itemSizeSystem(item), item.frontSize ?? null));
}

// Optional (secondary) sizes to suggest in the warehouse for a non-front item:
// the system's optional set, minus anything already present or needed.
function optionalHintSizes(item: RequestItem): string[] {
  if (item.frontSize) return [];
  return optionalSizesFor(itemSizeSystem(item)).filter(
    (size) =>
      !(Number(item.presentSizesQty?.[size]) > 0) &&
      !(Number(item.neededSizesQty?.[size]) > 0),
  );
}

// Order a size map for display: numeric keys sort numerically, otherwise use the
// XS..XL order (extra keys are appended by orderedSizeKeys).
function inferOrderedSizes(map: SizeQtyMap): string[] {
  const keys = Object.keys(map);
  if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
    return keys.slice().sort((a, b) => Number(a) - Number(b));
  }
  return LETTER_SIZES;
}

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
  warehouseNote?: string | null;
  sizeSystem?: string | null;
  frontSize?: number | null;
  presentSizesQty: SizeQtyMap;
  neededSizesQty: SizeQtyMap;
  substitutePriority: string[];
  product: Product;
};

type SessionSummary = {
  id: string;
  createdAt: string;
  status: string;
  _count: { items: number };
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

  const seasonDelta = compareLabelField(a.season, b.season);
  if (seasonDelta !== 0) {
    return seasonDelta;
  }

  const articleDelta = compareLabelField(a.article, b.article);
  if (articleDelta !== 0) {
    return articleDelta;
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
  variant,
}: {
  map: SizeQtyMap;
  variant: "need" | "present";
}) {
  const tokens = explodeSizeMap(map, inferOrderedSizes(map));
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

// Manual size-grid override: gender (Women/Men) + category (Letter/Jeans/Numeric).
function SizeGridPicker({
  system,
  onChange,
  compact = false,
}: {
  system: SizeSystem;
  onChange: (next: SizeSystem) => void;
  compact?: boolean;
}) {
  const gender = genderOf(system);
  const category = categoryOf(system);
  const btn = (active: boolean) =>
    `flex-1 rounded-lg border px-2 py-1.5 font-semibold transition-colors active:scale-[0.98] ${
      compact ? "text-xs" : "text-sm"
    } ${
      active
        ? "border-accent bg-accent-soft text-accent"
        : "border-black/10 text-black/60"
    }`;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {(["women", "men"] as Gender[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onChange(sizeSystemFromParts(g, category))}
            className={btn(gender === g)}
          >
            {g === "women" ? "Women" : "Men"}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        {CATEGORY_LABELS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(sizeSystemFromParts(gender, c.value))}
            className={btn(category === c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
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
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
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
  // Entry only appears after a scan or "Type manually"; back to scanner buttons after add.
  const [entryStarted, setEntryStarted] = useState(false);
  // Size system detected from the label's EUR line.
  const [sizeSystem, setSizeSystem] = useState<SizeSystem>("letter");
  // Front capacity: null = not on a front, otherwise 6 or 8 garments.
  const [frontSize, setFrontSize] = useState<number | null>(null);
  // Free-text comment for the current item (shown in both modes).
  const [note, setNote] = useState("");
  // Warehouse: collapse the handled (taken/absent) items so only needed ones stand out.
  const [showDone, setShowDone] = useState(false);
  // Finish confirmation modal + "send report" choice (report emailing is #5).
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [sendReport, setSendReport] = useState(false);
  // Inline editing of an already-added item (expanded row).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editArticle, setEditArticle] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editColorName, setEditColorName] = useState("");
  const [editSeason, setEditSeason] = useState("");
  const [editStorage, setEditStorage] = useState("");
  const [editPresent, setEditPresent] = useState<SizeQtyMap>({});
  const [editSystem, setEditSystem] = useState<SizeSystem>("letter");

  useEffect(() => {
    // Check for an existing session before doing anything else.
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const json = await res.json();
          setUser(json.user ?? null);
        }
      } catch {
        // treat as signed out
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    const createRequest = async () => {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
  }, [user]);

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

  const selectableSizes = selectableSizesFor(sizeSystem);
  const targetSizes = useMemo(
    () => buildTargetSizes(sizeSystem, frontSize),
    [sizeSystem, frontSize],
  );

  const neededPreview = useMemo(() => {
    const acc: SizeQtyMap = {};
    for (const [size, qty] of Object.entries(targetSizes)) {
      const have = presentSizesQty[size] ?? 0;
      if (have < qty) {
        acc[size] = qty - have;
      }
    }
    return acc;
  }, [targetSizes, presentSizesQty]);

  const presentSizeTokens = useMemo(
    () => explodeSizeMap(presentSizesQty, selectableSizes),
    [presentSizesQty, selectableSizes],
  );

  const neededSizeTokens = useMemo(
    () => explodeSizeMap(neededPreview, selectableSizes),
    [neededPreview, selectableSizes],
  );

  const hallPresentCount = presentTotal(presentSizesQty);
  const hallTargetCount = targetTotal(targetSizes);

  const hallBriefGroups = useMemo(
    () => groupItemsBySection(draftItems),
    [draftItems],
  );

  const warehouseActiveGroups = useMemo(
    () =>
      warehouseGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.pickStatus),
        }))
        .filter((group) => group.items.length > 0),
    [warehouseGroups],
  );

  const warehouseDoneItems = useMemo(
    () =>
      warehouseGroups.flatMap((group) =>
        group.items.filter((item) => item.pickStatus),
      ),
    [warehouseGroups],
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

  async function loadSessions() {
    try {
      const res = await fetch("/api/requests");
      if (res.ok) {
        const json = await res.json();
        setSessions((json.requests ?? []) as SessionSummary[]);
      }
    } catch {
      // ignore - the sessions panel is optional
    }
  }

  useEffect(() => {
    if (user) {
      void loadSessions();
    }
  }, [user]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    try {
      const endpoint = authMode === "signup" ? "register" : "login";
      const res = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername, password: authPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(
          errorMessage(json.error, "Could not sign in. Check your details and retry."),
        );
        return;
      }
      setAuthPassword("");
      setUser(json.user as { id: string; username: string });
    } catch {
      setAuthError("Network error. Please retry.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearStoredRequestId();
    setUser(null);
    setDraftItems([]);
    setWarehouseGroups([]);
    setSessions([]);
    setRequestId("");
    setEntryStarted(false);
    setLastParsed(null);
    setMode("hall");
  }

  async function handleScanLabel(file: File | null) {
    if (!file) {
      return;
    }

    setError("");
    setPhotoNotice("");
    setScanBusy(true);
    setEntryStarted(true);

    // A new photo starts a fresh item: wipe anything entered for the previous,
    // not-yet-added item (sizes, color, front, comment, detected size grid).
    setPresentSizesQty({});
    setColorValue("");
    setFrontSize(null);
    setNote("");
    setSizeSystem("letter");
    setLastParsed(null);
    setCurrentLabelPhotoUrl(null);
    setScannedForCurrentItem(false);
    setEditingId(null);

    const photoUrlPromise = createLabelPhotoUrl(file).catch(() => "");

    try {
      // Recycle the OCR workers periodically (before the passes start) so the
      // scanner does not lose accuracy over a long session.
      await beginScan();
      const detectionPromise = detectSizeToken(file).catch(() => null);
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

      // Pick the size system from the EUR token + the department (men's if the
      // department code starts with 45).
      const detection = await detectionPromise;
      const dept = extracted.parsed?.storageSection ?? "";
      setSizeSystem(resolveSizeSystem(detection, dept) ?? "letter");

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

  function handleTypeManually() {
    setError("");
    setPhotoNotice("");
    setSizeSystem("letter");
    setFrontSize(null);
    setNote("");
    setCurrentLabelPhotoUrl(null);
    setScannedForCurrentItem(false);
    setLastParsed(createEmptyParsedLabel());
    setEntryStarted(true);
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
          orderedSizes: selectableSizes,
          sizeSystem,
          frontSize,
          warehouseNote: note,
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
      setEntryStarted(false);
      setSizeSystem("letter");
      setFrontSize(null);
      setNote("");

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

    setShowFinishModal(false);
    setError("");
    setPhotoNotice("");
    setBusy(true);

    const finishedId = requestId;
    const withReport = sendReport;

    try {
      // Optionally email a PDF report of this session before it is closed.
      if (withReport) {
        await fetch(`/api/requests/${finishedId}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }

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
        body: JSON.stringify({}),
      });
      const json = await res.json();

      if (!res.ok) {
        setError("Unable to start a new replenishment.");
        return;
      }

      void loadSessions();

      storeRequestId(json.request.id);
      setRequestId(json.request.id);

      setDraftItems([]);
      setWarehouseGroups([]);
      setPresentSizesQty({});
      setLastParsed(null);
      setColorValue("");
      setCurrentLabelPhotoUrl(null);
      setScannedForCurrentItem(false);
      setEntryStarted(false);
      setSizeSystem("letter");
      setFrontSize(null);
      setNote("");
      setShowDone(false);
      setSendReport(false);
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

    const apply = (value: string | null) => {
      setWarehouseGroups((groups) =>
        groups.map((group) => ({
          ...group,
          items: group.items.map((entry) =>
            entry.id === item.id ? { ...entry, pickStatus: value } : entry,
          ),
        })),
      );
      // Keep the Hall short list in sync so worked items show struck through there too.
      setDraftItems((items) =>
        items.map((entry) =>
          entry.id === item.id ? { ...entry, pickStatus: value } : entry,
        ),
      );
    };

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

  function openEdit(item: RequestItem) {
    setError("");
    setEditingId(item.id);
    setEditArticle(item.article ?? "");
    setEditColor(item.color ?? "");
    setEditColorName(item.colorName ?? "");
    setEditSeason(item.season ?? "");
    setEditStorage(item.storageSection ?? "");
    setEditPresent({ ...(item.presentSizesQty ?? {}) });
    setEditSystem(itemSizeSystem(item));
  }

  async function saveEdit(item: RequestItem) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: editArticle,
          color: editColor,
          colorName: editColorName,
          season: editSeason,
          storageSection: editStorage,
          presentSizesQty: editPresent,
          sizeSystem: editSystem,
          frontSize: item.frontSize ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(errorMessage(json.error, "Failed to save changes"));
        return;
      }
      const updated = json.item as RequestItem;
      setDraftItems((items) => items.map((it) => (it.id === item.id ? updated : it)));
      setWarehouseGroups((groups) =>
        groups.map((group) => ({
          ...group,
          items: group.items.map((it) => (it.id === item.id ? updated : it)),
        })),
      );
      setEditingId(null);
    } catch {
      setError("Failed to save changes");
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

  if (!authChecked) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6 text-sm text-black/50">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
        <div className="rounded-2xl border border-black/10 bg-panel p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">
            Store replenishment
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {authMode === "signup" ? "Create account" : "Sign in"}
          </h1>
          <form onSubmit={submitAuth} className="mt-5 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/55">
              Username
              <input
                value={authUsername}
                onChange={(event) => setAuthUsername(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-black/55">
              Password
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
            {authError ? (
              <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm">{authError}</div>
            ) : null}
            <button
              type="submit"
              disabled={authBusy || !authUsername || !authPassword}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {authBusy
                ? "Please wait..."
                : authMode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setAuthMode((mode) => (mode === "signup" ? "signin" : "signup"));
              setAuthError("");
            }}
            className="mt-4 w-full text-center text-xs font-semibold text-accent underline underline-offset-2"
          >
            {authMode === "signup"
              ? "Have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </div>
      </div>
    );
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

      {showFinishModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Finish replenishment"
          onClick={() => !busy && setShowFinishModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Finish replenishment?</h2>
            <p className="mt-1 text-sm text-black/60">
              This closes the current session and clears the list. This cannot be undone.
            </p>

            <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-black/10 bg-background p-3">
              <input
                type="checkbox"
                checked={sendReport}
                onChange={(event) => setSendReport(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent,#2563eb)]"
              />
              <span className="text-sm">
                <span className="font-semibold">Send report</span>
                <span className="block text-xs text-black/55">
                  Email a PDF of this session to star00@list.ru
                </span>
              </span>
            </label>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowFinishModal(false)}
                className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-black/70 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFinishReplenishment()}
                className="flex-1 rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Finishing..." : "Finish"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent">
              Store replenishment
            </p>
            <h1 className="mt-2 text-2xl font-bold md:text-4xl">
              Hall scan and warehouse picking
            </h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-xs font-semibold text-black/55">@{user.username}</span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-black/60"
            >
              Log out
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-white p-3">
          <button
            type="button"
            onClick={() => {
              setShowSessions((value) => !value);
              if (!showSessions) void loadSessions();
            }}
            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-black/55"
          >
            <span>Your sessions ({sessions.length})</span>
            <span>{showSessions ? "Hide" : "Show"}</span>
          </button>
          {showSessions ? (
            sessions.length === 0 ? (
              <p className="mt-2 text-xs text-black/45">No past sessions yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-black/5">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-xs"
                  >
                    <span className="text-black/60">
                      {new Date(s.createdAt).toLocaleString()}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-black/45">{s._count.items} items</span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold ${
                          s.status === "DONE"
                            ? "bg-accent-soft text-accent"
                            : "bg-background text-black/50"
                        }`}
                      >
                        {s.status.toLowerCase()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
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
                <label className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-accent px-4 py-4 text-base font-semibold text-white active:scale-[0.99]">
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
                <div className="mt-2 flex items-center justify-center gap-5 text-xs font-semibold text-black/45">
                  <label className="cursor-pointer underline underline-offset-2 hover:text-black/70">
                    {scanBusy ? "..." : "Scan from gallery"}
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
                  <button
                    type="button"
                    disabled={scanBusy}
                    onClick={handleTypeManually}
                    className="underline underline-offset-2 hover:text-black/70 disabled:opacity-50"
                  >
                    Type manually
                  </button>
                </div>
              </div>

              {error ? (
                <div className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm">
                  {error}
                </div>
              ) : null}

              {entryStarted ? (
                <>
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
                  On front
                </p>
                <div className="mt-2 flex gap-2">
                  {([
                    ["No", null],
                    ["Front 6", 6],
                    ["Front 8", 8],
                  ] as const).map(([label, value]) => {
                    const active = frontSize === value;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setFrontSize(value)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors active:scale-[0.98] ${
                          active
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-black/10 text-black/60"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                  Size grid
                </p>
                <div className="mt-2">
                  <SizeGridPicker system={sizeSystem} onChange={setSizeSystem} />
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                    Choose existing sizes
                  </p>
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-bold text-accent">
                    in hall {hallPresentCount} / {hallTargetCount}
                  </span>
                </div>
                <div
                  className={`mt-2 grid gap-2 ${
                    selectableSizes.length > 5 ? "grid-cols-4" : "grid-cols-5"
                  }`}
                >
                  {selectableSizes.map((size) => (
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

              <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/60">
                  Comment
                </p>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  placeholder="Optional note"
                  className="mt-2 w-full rounded-lg border border-black/10 bg-background px-2 py-2 text-sm text-black outline-none ring-0 focus:border-accent"
                />
              </div>

              <button
                onClick={() => void handleAddItem()}
                disabled={busy || !lastParsed?.article}
                className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Add to list
              </button>
                </>
              ) : null}

              {!entryStarted && draftItems.length > 0 ? (
                <>
                  <button
                    onClick={() => void handleGoWarehouse()}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl border border-accent bg-white px-4 py-3 text-sm font-semibold text-accent disabled:opacity-60"
                  >
                    Go to warehouse
                  </button>

                  <button
                    onClick={() => setShowFinishModal(true)}
                    disabled={busy}
                    className="mt-2 w-full rounded-xl border border-danger/40 bg-white px-4 py-3 text-sm font-semibold text-danger disabled:opacity-60"
                  >
                    Finish replenishment
                  </button>
                </>
              ) : null}
            </section>

            <section className="rounded-2xl border border-black/10 bg-panel p-5 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold">Warehouse short list</h2>
              {hallBriefGroups.length === 0 ? (
                <p className="text-sm text-black/60">No items added yet.</p>
              ) : (
                <div className="space-y-5">
                  {hallBriefGroups.map((group) => (
                    <div
                      key={group.sectionId}
                      className="overflow-hidden rounded-xl border-2 border-accent/25 bg-white p-3 shadow-sm"
                    >
                      <h3 className="-mx-3 -mt-3 mb-3 flex items-center gap-2 rounded-t-xl bg-accent px-3 py-2.5 text-base font-bold uppercase tracking-wide text-white">
                        {group.sectionName}
                        <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                          {group.items.length}
                        </span>
                      </h3>
                      <div className="mt-2 space-y-1.5">
                        {group.items.map((item) => {
                          const editing = editingId === item.id;
                          const editSel = selectableSizesFor(editSystem);
                          const editTokens = explodeSizeMap(editPresent, editSel);
                          return (
                            <div key={item.id} className="rounded-lg bg-background px-3 py-2 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  className={`truncate font-semibold ${
                                    item.pickStatus ? "text-black/40 line-through" : ""
                                  }`}
                                >
                                  {item.article}
                                </span>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-bold text-accent">
                                    {presentTotal(item.presentSizesQty)} / {itemTargetCount(item)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => (editing ? setEditingId(null) : openEdit(item))}
                                    aria-label={editing ? "Close editor" : "Edit item"}
                                    aria-pressed={editing}
                                    title={editing ? "Close" : "Edit"}
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-base leading-none transition-colors active:scale-90 ${
                                      editing
                                        ? "border-accent bg-accent text-white"
                                        : "border-black/15 text-black/55"
                                    }`}
                                  >
                                    {editing ? "×" : "✏"}
                                  </button>
                                </div>
                              </div>

                              {editing ? (
                                <div className="mt-2 space-y-2">
                                  <div className="grid grid-cols-3 gap-2">
                                    <label className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                      article
                                      <input
                                        value={editArticle}
                                        inputMode="numeric"
                                        maxLength={7}
                                        onChange={(e) => setEditArticle(e.target.value.replace(/\D/g, "").slice(0, 7))}
                                        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm font-semibold outline-none focus:border-accent"
                                      />
                                    </label>
                                    <label className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                      season
                                      <input
                                        value={editSeason}
                                        inputMode="numeric"
                                        maxLength={1}
                                        onChange={(e) => setEditSeason(e.target.value.replace(/\D/g, "").slice(0, 1))}
                                        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm font-semibold outline-none focus:border-accent"
                                      />
                                    </label>
                                    <label className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                      dept
                                      <input
                                        value={editStorage}
                                        inputMode="numeric"
                                        maxLength={4}
                                        onChange={(e) => setEditStorage(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm font-semibold outline-none focus:border-accent"
                                      />
                                    </label>
                                  </div>

                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                    color
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      <input
                                        value={editColor}
                                        inputMode="numeric"
                                        maxLength={3}
                                        aria-label="color code"
                                        onChange={(e) => setEditColor(e.target.value.replace(/\D/g, "").slice(0, 3))}
                                        className="w-14 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm font-semibold outline-none focus:border-accent"
                                      />
                                      {COMMON_COLORS.map((sw) => {
                                        const sel = editColorName.toLowerCase() === sw.name;
                                        return (
                                          <button
                                            key={sw.name}
                                            type="button"
                                            onClick={() => setEditColorName(sel ? "" : sw.name)}
                                            aria-label={sw.label}
                                            title={sw.label}
                                            className={`h-6 w-6 rounded-full border ${
                                              sel ? "border-accent ring-2 ring-accent/40 ring-offset-1" : "border-black/15"
                                            }`}
                                            style={{ backgroundColor: sw.hex }}
                                          />
                                        );
                                      })}
                                      {editColorName ? (
                                        <button
                                          type="button"
                                          onClick={() => setEditColorName("")}
                                          aria-label="Clear color"
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/15 text-sm leading-none text-black/45"
                                        >
                                          ×
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                    grid
                                    <div className="mt-1">
                                      <SizeGridPicker
                                        system={editSystem}
                                        onChange={setEditSystem}
                                        compact
                                      />
                                    </div>
                                  </div>

                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
                                    sizes
                                    <div
                                      className={`mt-1 grid gap-1.5 ${
                                        editSel.length > 5 ? "grid-cols-4" : "grid-cols-5"
                                      }`}
                                    >
                                      {editSel.map((size) => (
                                        <button
                                          key={size}
                                          type="button"
                                          onClick={() =>
                                            setEditPresent((p) => ({ ...p, [size]: (p[size] ?? 0) + 1 }))
                                          }
                                          className="min-h-10 rounded-lg border border-accent bg-accent-soft px-1 py-1.5 text-center text-xs font-semibold text-accent active:scale-[0.97]"
                                        >
                                          {size}
                                        </button>
                                      ))}
                                    </div>
                                    <div className="mt-1.5 flex min-h-6 flex-wrap gap-1">
                                      {editTokens.length ? (
                                        editTokens.map((token, i) => (
                                          <button
                                            key={`${token}-${i}`}
                                            type="button"
                                            title="Remove one"
                                            onClick={() =>
                                              setEditPresent((p) => ({
                                                ...p,
                                                [token]: Math.max(0, (p[token] ?? 0) - 1),
                                              }))
                                            }
                                            className="rounded-md bg-white px-2 py-1 text-xs font-semibold active:scale-[0.97]"
                                          >
                                            {token}
                                          </button>
                                        ))
                                      ) : (
                                        <span className="text-xs text-black/40">-</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex gap-2 pt-1">
                                    <button
                                      type="button"
                                      disabled={busy || !editArticle}
                                      onClick={() => void saveEdit(item)}
                                      className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                      className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-black/60"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-black/50">
                                    <span className="uppercase tracking-wide">present</span>
                                    <SizeTiles map={item.presentSizesQty} variant="present" />
                                  </div>
                                  {item.color || item.colorName ? (
                                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-black/55">
                                      <span>color {formatLabelPart(item.color)}</span>
                                      {item.colorName ? <ColorSwatch value={item.colorName} size={12} /> : null}
                                    </p>
                                  ) : null}
                                  {item.warehouseNote ? (
                                    <p className="mt-0.5 text-xs italic text-black/50">
                                      {item.warehouseNote}
                                    </p>
                                  ) : null}
                                </>
                              )}
                            </div>
                          );
                        })}
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
                  Grouped by department. Sorted by season, article, color.
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
            ) : warehouseActiveGroups.length === 0 ? (
              <p className="text-sm text-black/60">
                All items handled. See the list below or finish.
              </p>
            ) : (
              <div className="space-y-5">
                {warehouseActiveGroups.map((group) => (
                  <div
                    key={group.sectionId}
                    className="overflow-hidden rounded-xl border-2 border-accent/25 bg-white p-3 shadow-sm"
                  >
                    <h3 className="-mx-3 -mt-3 mb-2 flex items-center gap-2 rounded-t-xl bg-accent px-3 py-2.5 text-base font-bold uppercase tracking-wide text-white">
                      {group.sectionName}
                      <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
                        {group.items.length}
                      </span>
                    </h3>
                    <div className="mt-1.5 divide-y divide-black/5">
                      {group.items.map((item) => (
                        <article key={item.id} className="py-2 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <div className="flex items-center gap-2">
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
                              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
                                {presentTotal(item.presentSizesQty)}/{itemTargetCount(item)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                                need
                              </span>
                              <SizeTiles map={item.neededSizesQty} variant="need" />
                              {optionalHintSizes(item).map((size) => (
                                <span
                                  key={`opt-${size}`}
                                  title={`Optional: bring ${size} if available`}
                                  className="inline-flex min-w-7 justify-center rounded-md border border-dashed border-black/30 bg-white px-1.5 py-1 text-xs font-semibold text-black/40"
                                >
                                  {size}?
                                </span>
                              ))}
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
                              <SizeTiles map={item.presentSizesQty} variant="present" />
                            </span>
                          </div>

                          {item.warehouseNote ? (
                            <p className="mt-1 text-xs italic text-black/50">
                              {item.warehouseNote}
                            </p>
                          ) : null}

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

            {warehouseDoneItems.length > 0 ? (
              <div className="mt-3 rounded-xl border border-black/10 bg-background/60 p-3">
                <button
                  type="button"
                  onClick={() => setShowDone((value) => !value)}
                  className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-black/45"
                >
                  <span>Picked / not in stock ({warehouseDoneItems.length})</span>
                  <span>{showDone ? "Hide" : "Show"}</span>
                </button>
                {showDone ? (
                  <div className="mt-2 divide-y divide-black/5">
                    {warehouseDoneItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 py-1 text-xs"
                      >
                        <span className="truncate text-black/40 line-through">
                          {item.article}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={
                              item.pickStatus === "taken" ? "text-accent" : "text-danger"
                            }
                          >
                            {item.pickStatus === "taken" ? "taken" : "absent"}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleSetPickStatus(
                                item,
                                item.pickStatus === "absent" ? "absent" : "taken",
                              )
                            }
                            className="text-black/40 underline underline-offset-2"
                            title="Move back to the active list"
                          >
                            undo
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              onClick={() => setShowFinishModal(true)}
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
