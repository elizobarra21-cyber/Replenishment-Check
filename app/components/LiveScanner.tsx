"use client";

import { useEffect, useRef, useState } from "react";
import { extractArticleFromLabel } from "@/lib/label-extractor";
import { recognizeStripCanvas } from "@/lib/ocr";

// Bank-app style live scanner: opens the rear camera with a masked "window",
// continuously OCRs the strip inside the window, and when the label code is
// recognized it snaps the frame, vibrates, and hands the still to the caller
// (which runs the authoritative parse via the normal photo pipeline).
export default function LiveScanner({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCaptureRef = useRef(onCapture);
  const onCloseRef = useRef(onClose);
  onCaptureRef.current = onCapture;
  onCloseRef.current = onClose;

  const [status, setStatus] = useState<"starting" | "scanning" | "error">(
    "starting",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let busy = false;
    let stopped = false;
    const capCanvas = document.createElement("canvas");

    async function snap() {
      stopped = true;
      if (timer) {
        window.clearInterval(timer);
      }
      const video = videoRef.current;
      const full = document.createElement("canvas");
      if (video && video.videoWidth) {
        full.width = video.videoWidth;
        full.height = video.videoHeight;
        full.getContext("2d")?.drawImage(video, 0, 0);
      }
      stream?.getTracks().forEach((track) => track.stop());
      try {
        navigator.vibrate?.(120);
      } catch {
        // vibration is best-effort
      }
      full.toBlob(
        (blob) => {
          if (blob) {
            onCaptureRef.current(new File([blob], "live-scan.jpg", { type: "image/jpeg" }));
          } else {
            onCloseRef.current();
          }
        },
        "image/jpeg",
        0.85,
      );
    }

    async function tick() {
      if (busy || stopped) {
        return;
      }
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        return;
      }
      busy = true;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        // Mask window: a horizontal band across the middle (matches the overlay).
        const bandW = vw * 0.8;
        const bandH = vh * 0.16;
        const sx = (vw - bandW) / 2;
        const sy = (vh - bandH) / 2;
        const scale = Math.min(2.5, 1100 / bandW); // upscale the small strip for OCR
        capCanvas.width = Math.max(1, Math.round(bandW * scale));
        capCanvas.height = Math.max(1, Math.round(bandH * scale));
        const ctx = capCanvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          return;
        }
        ctx.drawImage(video, sx, sy, bandW, bandH, 0, 0, capCanvas.width, capCanvas.height);

        const candidates = await recognizeStripCanvas(capCanvas);
        if (stopped) {
          return;
        }
        for (const candidate of candidates) {
          if (extractArticleFromLabel(candidate).parsed) {
            await snap();
            return;
          }
        }
      } finally {
        busy = false;
      }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setStatus("scanning");
        timer = window.setInterval(() => {
          void tick();
        }, 420);
      } catch {
        setStatus("error");
        setErrorMsg(
          "Camera not available here. Use 'Scan photo' or the gallery instead.",
        );
      }
    }

    void start();

    return () => {
      stopped = true;
      if (timer) {
        window.clearInterval(timer);
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-full w-full object-cover"
      />

      {/* Mask: dark top/bottom with a clear central band. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[42%] bg-black/55" />
        <div className="absolute inset-x-0 bottom-0 h-[42%] bg-black/55" />
        <div className="absolute inset-x-5 top-[42%] h-[16%] rounded-lg border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0)]" />
        <p className="absolute inset-x-0 top-[60%] mt-3 px-6 text-center text-sm font-medium text-white/90">
          {status === "error"
            ? errorMsg
            : "Line up the code above the barcode inside the frame"}
        </p>
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white">
          {status === "scanning" ? "Scanning..." : status === "error" ? "No camera" : "Starting..."}
        </span>
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          className="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black"
        >
          Close
        </button>
      </div>
    </div>
  );
}
