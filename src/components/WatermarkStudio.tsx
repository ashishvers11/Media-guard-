import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Download,
  RefreshCw,
  CheckCircle2,
  SlidersHorizontal,
  Move,
  Play,
  Pause,
  RotateCcw,
  X,
  Sparkles,
  FileCheck,
  AlertCircle,
  Scan,
  Wand2,
  Volume2,
} from 'lucide-react';
import {
  MediaKind,
  WatermarkBox,
  ProcessingProgress,
  HistoryRecord,
} from '../types/media';
import {
  WATERMARK_PRESETS,
  scanFrameForWatermarkCorners,
  inpaintRegionsOnContext,
} from '../utils/watermarkEngine';
import { BeforeAfterMediaSlider } from './BeforeAfterMediaSlider';

interface WatermarkStudioProps {
  onAddHistory: (item: HistoryRecord) => void;
}

const preloadedBlobUrls = new Map<string, string>();

/**
 * Checks whether the Express + FFmpeg backend API is reachable (and returning real JSON,
 * not Netlify's SPA index.html fallback).
 */
async function checkBackendServerAvailable(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.location.hostname.includes('netlify.app')) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/health', {
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    const data = await res.json();
    return data && data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Uploads a single binary chunk via XMLHttpRequest so mobile browsers report real-time byte-level
 * upload progress (`xhr.upload.onprogress`) every ~80ms.
 */
function uploadChunkWithXHR(
  url: string,
  chunkBlob: Blob,
  onByteProgress: (loadedBytesInChunk: number) => void
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onByteProgress(ev.loaded);
      }
    };

    xhr.onload = () => {
      const ct = xhr.getResponseHeader('content-type') || '';
      const isJson = ct.includes('application/json');
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300 && isJson,
        status: isJson ? xhr.status : 404,
      });
    };

    xhr.onerror = () => reject(new Error('Network error during chunk upload'));
    xhr.ontimeout = () => reject(new Error('Chunk upload timed out'));
    xhr.send(chunkBlob);
  });
}

/**
 * Downloads a server-stored media file in parallel 4 MB binary chunks and reassembles it into a
 * complete verified local Blob in browser memory.
 */
export async function fetchServerMediaInChunks(
  mediaUrlOrId: string,
  expectedSizeBytes?: number,
  onChunkProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Blob> {
  const match = mediaUrlOrId.match(/\/api\/(?:media|download)\/([^?&#/]+)/);
  const mediaId = match ? match[1] : mediaUrlOrId;

  const CHUNK_SIZE = 4 * 1024 * 1024;
  let totalSize = expectedSizeBytes && expectedSizeBytes > 0 ? expectedSizeBytes : 0;

  const fetchSingleRange = async (start: number, end: number): Promise<ArrayBuffer> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(
          `/api/download-chunk?id=${encodeURIComponent(mediaId)}&start=${start}&end=${end}`,
          { credentials: 'include' }
        );
        if (res.status === 416) {
          return new ArrayBuffer(0);
        }
        if (res.ok) {
          const headerTotal = Number(res.headers.get('X-Total-Size') || 0);
          if (headerTotal > 0) totalSize = headerTotal;
          return await res.arrayBuffer();
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Failed to download media chunk at byte ${start}`);
  };

  if (totalSize <= 0) {
    const firstBuf = await fetchSingleRange(0, CHUNK_SIZE - 1);
    if (totalSize <= firstBuf.byteLength || firstBuf.byteLength < CHUNK_SIZE) {
      if (onChunkProgress) onChunkProgress(firstBuf.byteLength, firstBuf.byteLength);
      return new Blob([firstBuf], { type: 'video/mp4' });
    }
  }

  const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
  const orderedBuffers: ArrayBuffer[] = new Array(numChunks);
  let loadedBytes = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < numChunks) {
      const idx = nextIndex++;
      const start = idx * CHUNK_SIZE;
      const end = Math.min(totalSize - 1, start + CHUNK_SIZE - 1);
      const buf = await fetchSingleRange(start, end);
      orderedBuffers[idx] = buf;
      loadedBytes += buf.byteLength;
      if (onChunkProgress && totalSize > 0) {
        onChunkProgress(Math.min(loadedBytes, totalSize), totalSize);
      }
    }
  };

  const concurrency = Math.min(3, numChunks);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const finalBlob = new Blob(orderedBuffers, { type: 'video/mp4' });
  if (finalBlob.size === 0) {
    throw new Error('Assembled media blob is 0 bytes');
  }
  return finalBlob;
}

/**
 * Reliable downloader that guarantees a non-zero Blob before triggering browser download.
 */
export async function triggerReliableDownload(
  primaryUrl: string,
  fallbackServerUrl: string,
  fileName: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  try {
    let targetBlobUrl = '';

    if (primaryUrl && primaryUrl.startsWith('blob:')) {
      try {
        const check = await fetch(primaryUrl);
        const blob = await check.blob();
        if (blob.size > 0) {
          targetBlobUrl = primaryUrl;
        }
      } catch {
        targetBlobUrl = '';
      }
    }

    if (!targetBlobUrl && fallbackServerUrl && preloadedBlobUrls.has(fallbackServerUrl)) {
      targetBlobUrl = preloadedBlobUrls.get(fallbackServerUrl)!;
    }

    if (!targetBlobUrl) {
      const sourceUrl = fallbackServerUrl || primaryUrl;
      if (sourceUrl.includes('/api/media/') || sourceUrl.includes('/api/download/')) {
        const blob = await fetchServerMediaInChunks(sourceUrl, undefined, (loaded, total) => {
          if (onProgress && total > 0) {
            onProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        });
        targetBlobUrl = URL.createObjectURL(blob);
        preloadedBlobUrls.set(sourceUrl, targetBlobUrl);
      } else {
        const res = await fetch(sourceUrl, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('Downloaded file is 0 bytes');
        targetBlobUrl = URL.createObjectURL(blob);
      }
    }

    if (onProgress) onProgress(100);

    const a = document.createElement('a');
    a.href = targetBlobUrl;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 1500);
  } catch (err) {
    console.error('Download error:', err);
  }
}

export const WatermarkStudio: React.FC<WatermarkStudioProps> = ({
  onAddHistory,
}) => {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [originalObjectUrl, setOriginalObjectUrl] = useState<string>('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('photo');
  const [nativeWidth, setNativeWidth] = useState<number>(1920);
  const [nativeHeight, setNativeHeight] = useState<number>(1080);

  const [boxes, setBoxes] = useState<WatermarkBox[]>([
    WATERMARK_PRESETS['bottom-right-gemini'],
  ]);
  const [showManualAdjust, setShowManualAdjust] = useState<boolean>(false);
  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);

  const [progress, setProgress] = useState<ProcessingProgress>({
    stage: 'idle',
    percent: 0,
    statusText: 'Upload a photo or video — watermark removal & HD enhancement run automatically.',
  });

  const [latestResult, setLatestResult] = useState<HistoryRecord | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState<boolean>(false);
  const [isCardVideoPlaying, setIsCardVideoPlaying] = useState<boolean>(false);
  const [downloadProgressPct, setDownloadProgressPct] = useState<number | null>(null);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const cardPlayerVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const activeJobIdRef = useRef<number>(0);

  const [dragState, setDragState] = useState<{
    mode: 'move' | 'resize' | null;
    startX: number;
    startY: number;
    initialBox: WatermarkBox;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    initialBox: WATERMARK_PRESETS['bottom-right-gemini'],
  });

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Render preview canvas for photo or when adjusting zone
  const renderStaticCanvas = useCallback(
    (activeBoxes: WatermarkBox[], showRawOriginal: boolean) => {
      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (mediaKind === 'photo' && sourceImageRef.current && sourceImageRef.current.complete) {
        const img = sourceImageRef.current;
        const w = img.naturalWidth || 1920;
        const h = img.naturalHeight || 1080;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.filter = showRawOriginal ? 'none' : 'contrast(1.04) saturate(1.08) brightness(1.01)';
        ctx.drawImage(img, 0, 0, w, h);
        ctx.filter = 'none';
        if (!showRawOriginal) {
          inpaintRegionsOnContext(ctx, w, h, activeBoxes);
        }
      } else if (mediaKind === 'video' && sourceVideoRef.current) {
        const vid = sourceVideoRef.current;
        const w = vid.videoWidth || 1280;
        const h = vid.videoHeight || 720;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.filter =
          showRawOriginal || showManualAdjust
            ? 'none'
            : 'contrast(1.04) saturate(1.08) brightness(1.01)';
        ctx.drawImage(vid, 0, 0, w, h);
        ctx.filter = 'none';
        if (!showRawOriginal && !showManualAdjust) {
          inpaintRegionsOnContext(ctx, w, h, activeBoxes);
        }
      }
    },
    [mediaKind, showManualAdjust]
  );

  useEffect(() => {
    if (!isProcessingRef.current) {
      renderStaticCanvas(boxes, compareOriginal);
    }
  }, [boxes, compareOriginal, renderStaticCanvas]);

  const detectWatermarkBoxesAutomatically = async (
    sourceEl: HTMLImageElement | HTMLVideoElement,
    w: number,
    h: number
  ): Promise<{ boxes: WatermarkBox[]; label: string; confidence: number }> => {
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = w;
    snapCanvas.height = h;
    const snapCtx = snapCanvas.getContext('2d')!;
    snapCtx.drawImage(sourceEl, 0, 0, w, h);

    const localScan = scanFrameForWatermarkCorners(snapCtx, w, h);

    if (typeof window !== 'undefined' && window.location.hostname.includes('netlify.app')) {
      return {
        boxes: localScan.boxes,
        label: localScan.boxes[0].label,
        confidence: localScan.confidence,
      };
    }

    try {
      const apiThumb = document.createElement('canvas');
      const scale = Math.min(1, 768 / Math.max(w, h));
      apiThumb.width = Math.max(64, Math.round(w * scale));
      apiThumb.height = Math.max(64, Math.round(h * scale));
      apiThumb.getContext('2d')!.drawImage(sourceEl, 0, 0, apiThumb.width, apiThumb.height);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);

      const res = await fetch('/api/detect-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: apiThumb.toDataURL('image/jpeg', 0.8),
          mimeType: 'image/jpeg',
          width: w,
          height: h,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data.regions) && data.regions.length > 0) {
          const apiBoxes: WatermarkBox[] = data.regions.map(
            (r: { label?: string; xPct: number; yPct: number; wPct: number; hPct: number }, i: number) => ({
              id: `auto-ai-${i}-${Date.now()}`,
              label: r.label || data.watermarkType || 'Gemini Star Watermark',
              xPct: Number(r.xPct),
              yPct: Number(r.yPct),
              wPct: Number(r.wPct),
              hPct: Number(r.hPct),
            })
          );
          return {
            boxes: apiBoxes,
            label: data.watermarkType || apiBoxes[0].label,
            confidence: data.confidence || 0.98,
          };
        }
      }
    } catch {
      // Fall back to local pixel anomaly scan
    }

    return {
      boxes: localScan.boxes,
      label: localScan.boxes[0].label,
      confidence: localScan.confidence,
    };
  };

  // AUTOMATIC PHOTO PIPELINE
  const runAutomaticPhotoPipeline = async (
    jobId: number,
    file: File,
    origUrl: string,
    img: HTMLImageElement,
    overrideBoxes?: WatermarkBox[]
  ) => {
    if (activeJobIdRef.current !== jobId) return;
    isProcessingRef.current = true;
    const startMs = performance.now();
    const w = img.naturalWidth || 1920;
    const h = img.naturalHeight || 1080;

    setProgress({
      stage: 'uploading',
      percent: 18,
      statusText: `Uploading photo ${file.name} (${formatBytes(file.size)})...`,
    });

    await new Promise((r) => setTimeout(r, 80));
    if (activeJobIdRef.current !== jobId) return;

    setProgress({
      stage: 'detecting-ai',
      percent: 45,
      statusText: `Detecting Gemini watermark on ${w}×${h}px photo...`,
    });

    const detection = overrideBoxes
      ? { boxes: overrideBoxes, label: overrideBoxes[0].label, confidence: 0.99 }
      : await detectWatermarkBoxesAutomatically(img, w, h);

    if (activeJobIdRef.current !== jobId) return;
    setBoxes(detection.boxes);

    setProgress({
      stage: 'inpainting',
      percent: 78,
      statusText: `Removing watermark & HD enhancing ${w}×${h}px photo...`,
    });

    await new Promise((r) => setTimeout(r, 50));
    if (activeJobIdRef.current !== jobId) return;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d')!;
    outCtx.filter = 'contrast(1.04) saturate(1.08) brightness(1.01)';
    outCtx.drawImage(img, 0, 0, w, h);
    outCtx.filter = 'none';
    inpaintRegionsOnContext(outCtx, w, h, detection.boxes);

    const dispCanvas = displayCanvasRef.current;
    if (dispCanvas) {
      dispCanvas.width = w;
      dispCanvas.height = h;
      dispCanvas.getContext('2d')?.drawImage(outCanvas, 0, 0);
    }

    setProgress({
      stage: 'encoding',
      percent: 92,
      statusText: 'Encoding lossless HD enhanced photo...',
    });

    const outMime = file.type === 'image/webp' ? 'image/webp' : 'image/png';
    const cleanedFileName =
      file.name.replace(/\.[^.]+$/, '') +
      '_watermark_free' +
      (outMime === 'image/webp' ? '.webp' : '.png');

    const outBlob = await new Promise<Blob>((resolve) =>
      outCanvas.toBlob((b) => resolve(b!), outMime, 1.0)
    );

    if (activeJobIdRef.current !== jobId) return;

    const cleanBlobUrl = URL.createObjectURL(outBlob);
    const totalElapsed = Math.round(performance.now() - startMs);

    const record: HistoryRecord = {
      id: `hist-photo-${jobId}`,
      originalFileName: file.name,
      originalFileUrl: origUrl,
      originalDownloadUrl: origUrl,
      fileName: cleanedFileName,
      kind: 'photo',
      originalWidth: w,
      originalHeight: h,
      originalSizeBytes: file.size,
      outputSizeBytes: outBlob.size,
      outputMimeType: outMime,
      outputUrl: cleanBlobUrl,
      outputDownloadUrl: cleanBlobUrl,
      originalPreviewUrl: origUrl,
      cleanedPreviewUrl: cleanBlobUrl,
      detectedType: detection.label,
      confidence: detection.confidence,
      regionsCount: detection.boxes.length,
      processedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      processingTimeMs: totalElapsed,
      inpaintMode: 'telea-harmonic',
    };

    isProcessingRef.current = false;
    setLatestResult(record);
    onAddHistory(record);
    setShowCompletionModal(true);

    setProgress({
      stage: 'completed',
      percent: 100,
      statusText: `Ready! Watermark removed & HD enhanced (${w}×${h}px · ${formatBytes(outBlob.size)}).`,
      elapsedMs: totalElapsed,
    });
  };

  // AUTOMATIC VIDEO PIPELINE:
  // Works on BOTH Full-Stack Server (FFmpeg CRF 14 + Stereo Audio) AND Static Hosts (Netlify WebView-safe pipeline)
  const runAutomaticVideoPipeline = async (
    jobId: number,
    file: File,
    origUrl: string,
    vid: HTMLVideoElement,
    overrideBoxes?: WatermarkBox[]
  ) => {
    if (activeJobIdRef.current !== jobId) return;
    isProcessingRef.current = true;
    const startMs = performance.now();
    const vw = vid.videoWidth || 1280;
    const vh = vid.videoHeight || 720;
    const duration = Math.max(0.5, vid.duration || 1);

    setProgress({
      stage: 'uploading',
      percent: 6,
      statusText: `Uploading Video: ${file.name} (${formatBytes(file.size)})...`,
    });

    // Seek briefly while muted to capture preview frame
    vid.muted = true;
    vid.pause();
    vid.currentTime = Math.min(0.15, duration * 0.1);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          vid.removeEventListener('seeked', finish);
          resolve();
        }
      };
      vid.addEventListener('seeked', finish);
      setTimeout(finish, 200);
    });

    if (activeJobIdRef.current !== jobId) return;

    const procCanvas = document.createElement('canvas');
    procCanvas.width = vw;
    procCanvas.height = vh;
    const procCtx = procCanvas.getContext('2d')!;
    procCtx.drawImage(vid, 0, 0, vw, vh);
    const origThumbUrl = procCanvas.toDataURL('image/jpeg', 0.7);

    const dispCanvas = displayCanvasRef.current;
    if (dispCanvas) {
      dispCanvas.width = vw;
      dispCanvas.height = vh;
      dispCanvas.getContext('2d')?.drawImage(procCanvas, 0, 0);
    }

    let tickerId: ReturnType<typeof setInterval> | null = null;

    try {
      let serverAvailable = await checkBackendServerAvailable();

      if (serverAvailable) {
        // STEP 1: Upload video in 2 MB chunks with real-time XHR byte progress
        const CHUNK_SIZE = 2 * 1024 * 1024;
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
        const uploadId = `${Date.now()}_${jobId}`;

        for (let idx = 0; idx < totalChunks; idx++) {
          if (activeJobIdRef.current !== jobId) return;

          const startByte = idx * CHUNK_SIZE;
          const endByte = Math.min(file.size, startByte + CHUNK_SIZE);
          const chunkBlob = file.slice(startByte, endByte);

          let chunkOk = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const chunkUrl = `/api/upload-chunk?uploadId=${encodeURIComponent(
                uploadId
              )}&index=${idx}&offset=${startByte}`;

              const chunkRes = await uploadChunkWithXHR(chunkUrl, chunkBlob, (loadedInChunk) => {
                if (activeJobIdRef.current !== jobId) return;
                const totalUploadedBytes = Math.min(file.size, startByte + loadedInChunk);
                const uploadRatio = totalUploadedBytes / Math.max(1, file.size);
                const overallPct = Math.min(54, Math.max(5, Math.round(5 + uploadRatio * 49)));
                const uploadPctText = Math.min(100, Math.round(uploadRatio * 100));

                setProgress({
                  stage: 'uploading',
                  percent: overallPct,
                  statusText: `Uploading: ${formatBytes(totalUploadedBytes)} / ${formatBytes(
                    file.size
                  )} (${uploadPctText}%)`,
                });
              });

              if (chunkRes.status === 404 || chunkRes.status === 405) {
                serverAvailable = false;
                break;
              }
              if (chunkRes.ok) {
                chunkOk = true;
                break;
              }
            } catch {
              // Retry chunk
            }
            await new Promise((r) => setTimeout(r, 350));
          }

          if (!serverAvailable) break;
          if (!chunkOk) {
            throw new Error(`Upload interrupted at chunk ${idx + 1}/${totalChunks}. Please retry.`);
          }
        }

        if (activeJobIdRef.current !== jobId) return;

        if (serverAvailable) {
          // STEP 2: Trigger Server-Side FFmpeg Watermark Removal + HD Enhancement + Full Stereo Audio
          let currentPct = 58;
          setProgress({
            stage: 'detecting-ai',
            percent: currentPct,
            statusText: `Detecting Gemini watermark on ${vw}×${vh}px video (${duration.toFixed(1)}s)...`,
          });

          tickerId = setInterval(() => {
            if (activeJobIdRef.current !== jobId) return;
            currentPct = Math.min(84, currentPct + 2);
            const activeStage = currentPct < 68 ? 'detecting-ai' : 'inpainting';
            setProgress({
              stage: activeStage,
              percent: currentPct,
              statusText:
                currentPct < 68
                  ? `Detecting exact Gemini star watermark (${currentPct}%)...`
                  : `Removing watermark, HD enhancing & preserving audio (${currentPct}%)...`,
            });
          }, 300);

          const finalizeRes = await fetch('/api/process-video-finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              uploadId,
              fileName: file.name,
              overrideBox: overrideBoxes ? overrideBoxes[0] : undefined,
            }),
          });

          if (tickerId) {
            clearInterval(tickerId);
            tickerId = null;
          }

          if (!finalizeRes.ok) {
            const errData = await finalizeRes.json().catch(() => ({}));
            throw new Error(errData.error || `Processing failed (${finalizeRes.status})`);
          }

          const serverResult = await finalizeRes.json();
          if (activeJobIdRef.current !== jobId) return;

          if (serverResult.detectedBox) {
            const detBox: WatermarkBox = {
              id: `det-${Date.now()}`,
              label: serverResult.detectedBox.label || 'Gemini Star Watermark',
              xPct: Number(serverResult.detectedBox.xPct),
              yPct: Number(serverResult.detectedBox.yPct),
              wPct: Number(serverResult.detectedBox.wPct),
              hPct: Number(serverResult.detectedBox.hPct),
            };
            setBoxes([detBox]);
            inpaintRegionsOnContext(procCtx, vw, vh, [detBox]);
          }

          const cleanedThumbUrl = procCanvas.toDataURL('image/jpeg', 0.75);
          const finalW = serverResult.width || vw;
          const finalH = serverResult.height || vh;
          const finalDurationSec = Number((serverResult.durationSec || duration).toFixed(1));
          setNativeWidth(finalW);
          setNativeHeight(finalH);

          // STEP 3: Assemble full MP4 Blob in parallel 4 MB chunks
          setProgress({
            stage: 'encoding',
            percent: 86,
            statusText: `Loading HD enhanced ${finalDurationSec}s video (${formatBytes(
              serverResult.outputSizeBytes
            )})...`,
          });

          const cleanVideoBlob = await fetchServerMediaInChunks(
            serverResult.outputMediaUrl,
            serverResult.outputSizeBytes,
            (loaded, total) => {
              if (activeJobIdRef.current !== jobId) return;
              const dlPct = Math.min(99, Math.round(86 + (loaded / Math.max(1, total)) * 13));
              setProgress({
                stage: 'encoding',
                percent: dlPct,
                statusText: `Loading HD video (${formatBytes(loaded)} / ${formatBytes(total)})...`,
              });
            }
          );

          if (activeJobIdRef.current !== jobId) return;

          const localCleanVideoUrl = URL.createObjectURL(cleanVideoBlob);
          preloadedBlobUrls.set(serverResult.outputMediaUrl, localCleanVideoUrl);

          const totalElapsed = Math.round(performance.now() - startMs);
          const finalSizeBytes = cleanVideoBlob.size || serverResult.outputSizeBytes;

          const record: HistoryRecord = {
            id: `hist-vid-${jobId}`,
            originalFileName: file.name,
            originalFileUrl: origUrl,
            originalDownloadUrl: serverResult.originalMediaUrl,
            fileName: serverResult.cleanedFileName,
            kind: 'video',
            originalWidth: finalW,
            originalHeight: finalH,
            originalSizeBytes: file.size,
            outputSizeBytes: finalSizeBytes,
            outputMimeType: 'video/mp4',
            outputUrl: localCleanVideoUrl,
            outputDownloadUrl: serverResult.outputMediaUrl,
            originalPreviewUrl: origThumbUrl,
            cleanedPreviewUrl: cleanedThumbUrl,
            detectedType: serverResult.detectedBox?.label || 'Gemini Star Watermark',
            confidence: serverResult.detectedBox?.confidence || 0.99,
            regionsCount: 1,
            durationSec: finalDurationSec,
            processedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            processingTimeMs: totalElapsed,
            inpaintMode: 'telea-harmonic',
          };

          isProcessingRef.current = false;
          setLatestResult(record);
          onAddHistory(record);
          setShowCompletionModal(true);

          setProgress({
            stage: 'completed',
            percent: 100,
            statusText: `Ready! Full ${finalDurationSec}s HD enhanced video with audio (${finalW}×${finalH}px · ${formatBytes(
              finalSizeBytes
            )}).`,
            elapsedMs: totalElapsed,
          });
          return;
        }
      }

      // =========================================================================
      // STATIC HOSTING MODE (Netlify / Mobile WebView Safe Pipeline):
      // 1. Keeps vid.muted = true ALWAYS so Android WebView / Telegram NEVER throws
      //    "play() can only be initiated by a user gesture"!
      // 2. Extracts 100% full-volume original audio directly from file.arrayBuffer()
      //    via AudioContext.decodeAudioData() into MediaStreamDestination!
      // 3. Enhances every frame (contrast + saturation + brightness) & removes watermark!
      // =========================================================================
      setProgress({
        stage: 'uploading',
        percent: 22,
        statusText: `Reading ${file.name} (${formatBytes(file.size)}) into memory...`,
      });

      const fileArrayBuf = await file.arrayBuffer();
      if (activeJobIdRef.current !== jobId) return;

      setProgress({
        stage: 'detecting-ai',
        percent: 38,
        statusText: `Detecting Gemini watermark & decoding stereo audio (${vw}×${vh}px)...`,
      });

      const localScan = overrideBoxes
        ? { boxes: overrideBoxes, confidence: 0.99 }
        : scanFrameForWatermarkCorners(procCtx, vw, vh);
      setBoxes(localScan.boxes);
      inpaintRegionsOnContext(procCtx, vw, vh, localScan.boxes);
      const cleanedThumbUrl = procCanvas.toDataURL('image/jpeg', 0.75);

      const recW = Math.max(2, Math.round(vw / 2) * 2);
      const recH = Math.max(2, Math.round(vh / 2) * 2);

      const recCanvas = document.createElement('canvas');
      recCanvas.width = recW;
      recCanvas.height = recH;
      const recCtx = recCanvas.getContext('2d')!;

      // Decode full-volume audio directly from the uploaded file bytes (no unmuted <video> play needed!)
      let audioTracks: MediaStreamTrack[] = [];
      let audioBufferSource: AudioBufferSourceNode | null = null;
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioContext();
        }
        const aCtx = audioCtxRef.current;
        if (aCtx.state === 'suspended') {
          await aCtx.resume().catch(() => {});
        }
        const decodedAudio = await aCtx.decodeAudioData(fileArrayBuf.slice(0));
        const destNode = aCtx.createMediaStreamDestination();
        audioBufferSource = aCtx.createBufferSource();
        audioBufferSource.buffer = decodedAudio;
        audioBufferSource.connect(destNode);
        audioTracks = destNode.stream.getAudioTracks();
      } catch {
        // Video has no audio track or browser couldn't decode audio container
      }

      const canvasVideoStream = recCanvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasVideoStream.getVideoTracks(),
        ...audioTracks,
      ]);

      const mimeCandidates = [
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const chosenMime =
        mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = new MediaRecorder(
        combinedStream,
        chosenMime
          ? { mimeType: chosenMime, videoBitsPerSecond: 18_000_000 }
          : { videoBitsPerSecond: 18_000_000 }
      );
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const recDone = new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(
            new Blob(chunks, {
              type: chosenMime.includes('mp4') ? 'video/mp4' : 'video/webm',
            })
          );
      });

      // Keep vid.muted = true so WebView NEVER throws "play() can only be initiated by a user gesture"
      vid.pause();
      vid.muted = true;
      vid.currentTime = 0;
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            vid.removeEventListener('seeked', finish);
            resolve();
          }
        };
        vid.addEventListener('seeked', finish);
        setTimeout(finish, 250);
      });

      recorder.start(100);
      if (audioBufferSource) {
        try {
          audioBufferSource.start(0);
        } catch {
          // Ignore if already started
        }
      }

      // Attempt muted playback; if a strict WebView blocks even muted play(), fall back to deterministic frame stepping!
      const playSucceeded = await vid
        .play()
        .then(() => true)
        .catch(() => false);

      if (playSucceeded) {
        await new Promise<void>((resolve) => {
          const drawTick = () => {
            if (activeJobIdRef.current !== jobId) {
              if (recorder.state !== 'inactive') recorder.stop();
              resolve();
              return;
            }
            recCtx.filter = 'contrast(1.04) saturate(1.08) brightness(1.01)';
            recCtx.drawImage(vid, 0, 0, recW, recH);
            recCtx.filter = 'none';
            inpaintRegionsOnContext(recCtx, recW, recH, localScan.boxes);

            const pct = Math.min(98, Math.round(42 + (vid.currentTime / duration) * 56));
            setProgress({
              stage: 'inpainting',
              percent: pct,
              statusText: `Cleaning watermark & HD enhancing (${vid.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)...`,
            });

            if (vid.ended || vid.currentTime >= duration - 0.03) {
              if (recorder.state !== 'inactive') recorder.stop();
              resolve();
              return;
            }

            if (vid.paused && !vid.ended) {
              vid.muted = true;
              vid.play().catch(() => {});
            }

            requestAnimationFrame(drawTick);
          };
          vid.onended = () => {
            if (recorder.state !== 'inactive') recorder.stop();
            resolve();
          };
          requestAnimationFrame(drawTick);
        });
      } else {
        // Gesture-free deterministic frame stepping at 24fps if WebView blocked vid.play()
        const fps = 24;
        const totalFrames = Math.max(1, Math.ceil(duration * fps));
        for (let f = 0; f < totalFrames; f++) {
          if (activeJobIdRef.current !== jobId) break;
          const targetTime = Math.min(duration - 0.01, f / fps);
          vid.currentTime = targetTime;
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                vid.removeEventListener('seeked', finish);
                resolve();
              }
            };
            vid.addEventListener('seeked', finish);
            setTimeout(finish, 40);
          });
          recCtx.filter = 'contrast(1.04) saturate(1.08) brightness(1.01)';
          recCtx.drawImage(vid, 0, 0, recW, recH);
          recCtx.filter = 'none';
          inpaintRegionsOnContext(recCtx, recW, recH, localScan.boxes);

          const pct = Math.min(98, Math.round(42 + ((f + 1) / totalFrames) * 56));
          setProgress({
            stage: 'inpainting',
            percent: pct,
            statusText: `Cleaning watermark & HD enhancing (${targetTime.toFixed(1)}s / ${duration.toFixed(1)}s)...`,
          });
        }
        if (recorder.state !== 'inactive') recorder.stop();
      }

      if (audioBufferSource) {
        try {
          audioBufferSource.stop();
        } catch {
          // Ignore
        }
      }

      const outBlob = await recDone;
      if (outBlob.size === 0) {
        throw new Error('Video encoder returned 0 bytes.');
      }

      const localCleanUrl = URL.createObjectURL(outBlob);
      const ext = chosenMime.includes('mp4') ? '.mp4' : '.webm';
      const cleanedName = file.name.replace(/\.[^.]+$/, '') + '_watermark_free' + ext;
      const totalElapsed = Math.round(performance.now() - startMs);

      const record: HistoryRecord = {
        id: `hist-vid-${jobId}`,
        originalFileName: file.name,
        originalFileUrl: origUrl,
        originalDownloadUrl: origUrl,
        fileName: cleanedName,
        kind: 'video',
        originalWidth: recW,
        originalHeight: recH,
        originalSizeBytes: file.size,
        outputSizeBytes: outBlob.size,
        outputMimeType: outBlob.type || 'video/webm',
        outputUrl: localCleanUrl,
        outputDownloadUrl: localCleanUrl,
        originalPreviewUrl: origThumbUrl,
        cleanedPreviewUrl: cleanedThumbUrl,
        detectedType: localScan.boxes[0].label,
        confidence: localScan.confidence,
        regionsCount: 1,
        durationSec: Number(duration.toFixed(1)),
        processedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        processingTimeMs: totalElapsed,
        inpaintMode: 'telea-harmonic',
      };

      isProcessingRef.current = false;
      setLatestResult(record);
      onAddHistory(record);
      setShowCompletionModal(true);
      setProgress({
        stage: 'completed',
        percent: 100,
        statusText: `Ready! Full ${duration.toFixed(1)}s HD enhanced video (${recW}×${recH}px · ${formatBytes(
          outBlob.size
        )}).`,
        elapsedMs: totalElapsed,
      });
    } catch (err: unknown) {
      if (tickerId) clearInterval(tickerId);
      isProcessingRef.current = false;
      const errMsg = err instanceof Error ? err.message : 'Failed to process video.';
      setProgress({
        stage: 'error',
        percent: 100,
        statusText: `Error: ${errMsg}`,
      });
    }
  };

  // Triggered when user selects or drops a photo or video (Runs inside user gesture!)
  const handleSelectFile = (file: File) => {
    const nextJobId = activeJobIdRef.current + 1;
    activeJobIdRef.current = nextJobId;

    // Synchronously unlock WebAudio inside the active user gesture
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      // Ignore
    }

    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
    const kind: MediaKind = isVideo ? 'video' : 'photo';
    const url = URL.createObjectURL(file);

    setMediaFile(file);
    setOriginalObjectUrl(url);
    setMediaKind(kind);
    setLatestResult(null);
    setShowCompletionModal(false);
    setShowManualAdjust(false);
    setCompareOriginal(false);
    setIsCardVideoPlaying(false);
    setDownloadProgressPct(null);

    setProgress({
      stage: 'uploading',
      percent: 5,
      statusText: `Uploading ${file.name} (${formatBytes(file.size)})...`,
    });

    if (!isVideo) {
      const img = new Image();
      img.onload = () => {
        if (activeJobIdRef.current !== nextJobId) return;
        sourceImageRef.current = img;
        setNativeWidth(img.naturalWidth || 1920);
        setNativeHeight(img.naturalHeight || 1080);
        runAutomaticPhotoPipeline(nextJobId, file, url, img);
      };
      img.src = url;
    } else {
      const vid = sourceVideoRef.current;
      if (vid) {
        let triggered = false;
        vid.muted = true;
        vid.playsInline = true;
        vid.onloadedmetadata = () => {
          if (triggered || activeJobIdRef.current !== nextJobId) return;
          triggered = true;
          vid.onloadedmetadata = null;
          setNativeWidth(vid.videoWidth || 1280);
          setNativeHeight(vid.videoHeight || 720);
          runAutomaticVideoPipeline(nextJobId, file, url, vid);
        };
        vid.src = url;
        // Synchronously prime video element inside the user gesture so mobile WebView unlocks it
        const p = vid.play();
        if (p !== undefined) {
          p.then(() => {
            vid.pause();
          }).catch(() => {
            vid.load();
          });
        }
      }
    }
  };

  const handleReprocessWithCustomBox = () => {
    if (!mediaFile || !originalObjectUrl) return;
    const nextJobId = activeJobIdRef.current + 1;
    activeJobIdRef.current = nextJobId;
    setShowManualAdjust(false);
    setShowCompletionModal(false);

    if (mediaKind === 'photo' && sourceImageRef.current) {
      runAutomaticPhotoPipeline(nextJobId, mediaFile, originalObjectUrl, sourceImageRef.current, boxes);
    } else if (mediaKind === 'video' && sourceVideoRef.current) {
      runAutomaticVideoPipeline(nextJobId, mediaFile, originalObjectUrl, sourceVideoRef.current, boxes);
    }
  };

  const handleDownloadCleaned = async (resRecord: HistoryRecord) => {
    if (downloadProgressPct !== null) return;
    setDownloadProgressPct(1);
    try {
      await triggerReliableDownload(
        resRecord.outputUrl,
        resRecord.outputDownloadUrl,
        resRecord.fileName,
        (pct) => setDownloadProgressPct(pct)
      );
    } finally {
      setTimeout(() => setDownloadProgressPct(null), 600);
    }
  };

  const handleToggleCardVideoPlay = () => {
    const v = cardPlayerVideoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = 1.0;
    if (v.paused) {
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
      setIsCardVideoPlaying(true);
    } else {
      v.pause();
      setIsCardVideoPlaying(false);
    }
  };

  const handleRestartCardVideo = () => {
    const v = cardPlayerVideoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = 1.0;
    v.currentTime = 0;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => {});
    });
    setIsCardVideoPlaying(true);
  };

  const handleBoxPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...boxes[0] },
    });
  };

  const handleBoxPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.mode || !previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxPct = ((e.clientX - dragState.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - dragState.startY) / rect.height) * 100;

    if (dragState.mode === 'move') {
      const nextX = Math.max(0, Math.min(100 - dragState.initialBox.wPct, dragState.initialBox.xPct + dxPct));
      const nextY = Math.max(0, Math.min(100 - dragState.initialBox.hPct, dragState.initialBox.yPct + dyPct));
      setBoxes([
        {
          ...dragState.initialBox,
          label: 'Custom Watermark Region',
          xPct: Number(nextX.toFixed(1)),
          yPct: Number(nextY.toFixed(1)),
        },
      ]);
    } else if (dragState.mode === 'resize') {
      const nextW = Math.max(5, Math.min(100 - dragState.initialBox.xPct, dragState.initialBox.wPct + dxPct));
      const nextH = Math.max(5, Math.min(100 - dragState.initialBox.yPct, dragState.initialBox.hPct + dyPct));
      setBoxes([
        {
          ...dragState.initialBox,
          label: 'Custom Watermark Region',
          wPct: Number(nextW.toFixed(1)),
          hPct: Number(nextH.toFixed(1)),
        },
      ]);
    }
  };

  const handleBoxPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.mode) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragState((prev) => ({ ...prev, mode: null }));
    }
  };

  const currentBox = boxes[0] || WATERMARK_PRESETS['bottom-right-gemini'];
  const isBusy =
    progress.stage === 'uploading' ||
    progress.stage === 'analyzing' ||
    progress.stage === 'detecting-ai' ||
    progress.stage === 'inpainting' ||
    progress.stage === 'encoding';

  const activeStepIndex =
    progress.stage === 'uploading' || progress.stage === 'analyzing'
      ? 1
      : progress.stage === 'detecting-ai'
      ? 2
      : progress.stage === 'inpainting' || progress.stage === 'encoding'
      ? 3
      : progress.stage === 'completed'
      ? 4
      : 0;

  const showPlayableVideoInCard =
    mediaKind === 'video' && Boolean(latestResult) && !isBusy && !showManualAdjust;

  const activeVideoSrcInCard = compareOriginal
    ? latestResult?.originalFileUrl || originalObjectUrl
    : latestResult?.outputUrl || '';

  return (
    <div className="w-full max-w-4xl mx-auto space-y-5 min-w-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleSelectFile(f);
          e.target.value = '';
        }}
        className="hidden"
      />
      {/* Contained 1x1px video inside viewport bounds so mobile WebViews never shift horizontally */}
      <video
        ref={sourceVideoRef}
        className="fixed left-0 top-0 w-px h-px opacity-0 pointer-events-none overflow-hidden -z-10"
        playsInline
        muted
        crossOrigin="anonymous"
      />

      {/* Main Studio Card */}
      <div className="bg-[#121811] border border-[#263224] rounded-3xl p-4 sm:p-6 space-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] w-full min-w-0 overflow-hidden">
        {!mediaFile ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleSelectFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-2xl border-2 border-dashed border-[#3E5338] bg-[#171F15] hover:bg-[#1D271B] transition-all py-14 sm:py-16 px-5 text-center cursor-pointer flex flex-col items-center justify-center gap-3.5"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#84A96A]/15 border border-[#84A96A]/60 flex items-center justify-center shadow-inner">
              <Upload className="w-6 h-6 text-[#A3C686]" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <h2 className="text-lg sm:text-2xl font-bold text-[#F3F7F1] tracking-tight font-display">
                Upload Photo or Video
              </h2>
              <p className="text-xs sm:text-sm text-[#9AA895] leading-relaxed">
                100% automatic Gemini watermark removal + clean HD visual enhancement with full original audio.
              </p>
            </div>
            <span className="mt-1 px-6 py-3 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs sm:text-sm tracking-wide shadow-md transition-colors">
              Select Photo or Video
            </span>
          </div>
        ) : (
          <>
            {/* Top Bar inside Card — Clean Mobile Responsive Stack */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1E281C]">
              <div className="flex items-center gap-2 text-xs text-[#A9B8A4] font-mono min-w-0">
                <span className="inline-block w-2 h-2 rounded-full bg-[#84A96A] shrink-0" />
                <span className="text-[#F1F5F0] font-semibold truncate">
                  {mediaFile.name}
                </span>
                <span className="text-[#566652] shrink-0">·</span>
                <span className="shrink-0">{nativeWidth}×{nativeHeight}px</span>
                {latestResult?.durationSec && (
                  <>
                    <span className="text-[#566652] shrink-0">·</span>
                    <span className="shrink-0">{latestResult.durationSec}s</span>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    const next = !showManualAdjust;
                    setShowManualAdjust(next);
                    if (next && mediaKind === 'video' && sourceVideoRef.current) {
                      setTimeout(() => renderStaticCanvas(boxes, true), 30);
                    }
                  }}
                  disabled={isBusy}
                  className="h-9 px-3 rounded-xl bg-[#1A2218] hover:bg-[#232E21] border border-[#2F3E2C] text-xs font-semibold text-[#D5E3CE] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#A3C686] shrink-0" />
                  <span>{showManualAdjust ? 'Close Zone' : 'Adjust Zone'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  className="h-9 px-3.5 rounded-xl bg-[#222F1F] hover:bg-[#2C3C28] border border-[#496142] text-xs font-bold text-[#E2F1D5] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span>New File</span>
                </button>
              </div>
            </div>

            {/* Upgraded 4-Step Visual Progress Card — Never Truncates on Mobile! */}
            <div className="bg-[#0D120C] border border-[#253123] rounded-2xl p-3.5 sm:p-4 space-y-3">
              {/* 4-Stage Stepper Grid (Stacked Icon + Crisp Full Word for Mobile) */}
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
                {[
                  { step: 1, label: 'Upload', icon: Upload },
                  { step: 2, label: 'Detect', icon: Scan },
                  { step: 3, label: 'Clean HD', icon: Wand2 },
                  { step: 4, label: 'Ready', icon: CheckCircle2 },
                ].map(({ step, label, icon: Icon }) => {
                  const isCompleted = activeStepIndex > step || progress.stage === 'completed';
                  const isCurrent = activeStepIndex === step && progress.stage !== 'completed';
                  return (
                    <div
                      key={step}
                      className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-xl border text-[11px] sm:text-xs font-bold tracking-tight transition-all ${
                        isCurrent
                          ? 'bg-[#84A96A]/20 border-[#84A96A] text-[#F1F8EC] shadow-[0_0_14px_rgba(132,169,106,0.22)]'
                          : isCompleted
                          ? 'bg-[#172116] border-[#3B5036] text-[#A3C686]'
                          : 'bg-[#111610] border-[#1D261B] text-[#667562]'
                      }`}
                    >
                      {isCurrent ? (
                        <RefreshCw className="w-3.5 h-3.5 text-[#A3C686] animate-spin shrink-0" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#A3C686] shrink-0" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span className="whitespace-nowrap">{label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Live Status Text & Percentage */}
              <div className="flex items-start justify-between gap-3 text-xs">
                <span className="text-[#D7E8C8] font-medium flex items-start gap-2 min-w-0 leading-snug">
                  {isBusy ? (
                    <span className="mt-1 inline-block w-2 h-2 rounded-full bg-[#A3C686] animate-ping shrink-0" />
                  ) : progress.stage === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-[#F87171] shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#A3C686] shrink-0 mt-0.5" />
                  )}
                  <span className="break-words">{progress.statusText}</span>
                </span>
                <span className="font-mono tabular-nums font-bold text-sm text-[#A3C686] shrink-0">
                  {progress.percent}%
                </span>
              </div>

              {/* Smooth Animated Progress Bar Track */}
              <div className="w-full h-2.5 bg-[#080B08] rounded-full overflow-hidden border border-[#222D20]">
                <div
                  style={{ width: `${Math.max(3, progress.percent)}%` }}
                  className={`h-full rounded-full transition-all duration-150 ease-out ${
                    progress.stage === 'error'
                      ? 'bg-[#F87171]'
                      : 'bg-gradient-to-r from-[#6D8F54] via-[#84A96A] to-[#A3C686]'
                  }`}
                />
              </div>
            </div>

            {/* Optional Manual Corner / Box Adjuster */}
            {showManualAdjust && (
              <div className="bg-[#0D120C] border border-[#2E3C2B] rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(WATERMARK_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBoxes([{ ...preset }])}
                      className="px-2.5 py-1.5 rounded-lg bg-[#182016] hover:bg-[#232F20] border border-[#2B3829] text-xs font-medium text-[#D5E3CE] cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleReprocessWithCustomBox}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs cursor-pointer"
                >
                  Apply &amp; Re-Clean Now
                </button>
              </div>
            )}

            {/* Main Media Viewport inside Card */}
            <div className="relative bg-[#0C100B] rounded-2xl overflow-hidden border border-[#2A3728] w-full">
              <div
                ref={previewContainerRef}
                onPointerMove={handleBoxPointerMove}
                onPointerUp={handleBoxPointerUp}
                className="relative w-full max-h-[500px] min-h-[240px] flex items-center justify-center select-none overflow-hidden bg-black"
              >
                <canvas
                  ref={displayCanvasRef}
                  className={
                    showPlayableVideoInCard
                      ? 'hidden'
                      : 'max-h-[480px] w-auto max-w-full object-contain block'
                  }
                />

                {showPlayableVideoInCard && (
                  <video
                    ref={cardPlayerVideoRef}
                    key={activeVideoSrcInCard}
                    src={activeVideoSrcInCard}
                    controls
                    playsInline
                    onLoadedMetadata={(e) => {
                      e.currentTarget.muted = false;
                      e.currentTarget.volume = 1.0;
                    }}
                    onPlay={() => setIsCardVideoPlaying(true)}
                    onPause={() => setIsCardVideoPlaying(false)}
                    className="max-h-[480px] w-full object-contain block"
                  />
                )}

                {showManualAdjust && (
                  <div
                    onPointerDown={(e) => handleBoxPointerDown(e, 'move')}
                    style={{
                      left: `${currentBox.xPct}%`,
                      top: `${currentBox.yPct}%`,
                      width: `${currentBox.wPct}%`,
                      height: `${currentBox.hPct}%`,
                    }}
                    className="absolute border-2 border-[#A3C686] bg-[#84A96A]/25 rounded-lg cursor-move"
                  >
                    <div className="absolute -top-6 right-0 bg-[#151B14] text-[#D7E8C8] border border-[#84A96A]/50 px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap flex items-center gap-1">
                      <Move className="w-3 h-3 text-[#A3C686]" />
                      <span>Drag Zone</span>
                    </div>
                    <div
                      onPointerDown={(e) => handleBoxPointerDown(e, 'resize')}
                      className="absolute -bottom-2 -right-2 w-4 h-4 bg-[#A3C686] border-2 border-[#0E130D] rounded-sm cursor-nwse-resize"
                    />
                  </div>
                )}
              </div>

              {/* Dedicated In-Card Video Player Control & Status Bar */}
              <div className="bg-[#182116] border-t border-[#2A3728] text-[#E6F0E0] px-3.5 py-2.5 text-xs font-medium flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {showPlayableVideoInCard && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleToggleCardVideoPlay}
                        className="px-2.5 py-1 rounded-lg bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        {isCardVideoPlaying ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Play HD</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleRestartCardVideo}
                        className="px-2 py-1 rounded-lg bg-[#111710] hover:bg-[#1C261A] border border-[#2E3C2B] text-[#D5E3CE] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Replay</span>
                      </button>
                    </div>
                  )}

                  <span className="inline-flex items-center gap-1.5 text-[#A9B8A4] min-w-0">
                    {!isBusy && mediaKind === 'video' && (
                      <Volume2 className="w-3.5 h-3.5 text-[#A3C686] shrink-0" />
                    )}
                    <span className="truncate">
                      {isBusy
                        ? progress.stage === 'uploading'
                          ? 'Step 1: Uploading...'
                          : progress.stage === 'detecting-ai'
                          ? 'Step 2: Detecting Watermark...'
                          : 'Step 3: Cleaning & HD Enhancing...'
                        : compareOriginal
                        ? 'Viewing: Original Media'
                        : 'Viewing: Watermark-Free + HD Enhanced'}
                    </span>
                  </span>
                </div>

                {latestResult && !isBusy && (
                  <button
                    type="button"
                    onClick={() => setCompareOriginal((prev) => !prev)}
                    className="px-2.5 py-1 rounded-lg bg-[#232F20] hover:bg-[#2D3C29] border border-[#3B4E37] text-[#E6F2DC] font-semibold cursor-pointer shrink-0"
                  >
                    {compareOriginal ? 'Show Clean HD' : 'Compare Original'}
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Action Bar inside Card */}
            {latestResult && !isBusy && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCompletionModal(true)}
                  className="px-4 py-2.5 rounded-xl bg-[#1A2318] hover:bg-[#232F20] border border-[#344631] text-xs font-bold text-[#D7E8C8] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#A3C686]" />
                  <span>Before / After Compare Modal</span>
                </button>

                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      triggerReliableDownload(
                        latestResult.originalFileUrl,
                        latestResult.originalDownloadUrl,
                        latestResult.originalFileName
                      )
                    }
                    className="px-3.5 py-2.5 rounded-xl bg-[#182016] hover:bg-[#222D1F] border border-[#2F3E2C] text-[#D5E3CE] font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Original</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadCleaned(latestResult)}
                    className="px-4 py-2.5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {downloadProgressPct !== null ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>Saving {downloadProgressPct}%</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>Watermark-Free HD</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =========================================================================
          PROCESSING COMPLETE MODAL: Interactive Before/After Slider + Downloads
          ========================================================================= */}
      {showCompletionModal && latestResult && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setShowCompletionModal(false)}
        >
          <div
            className="bg-[#121811] border border-[#344631] rounded-3xl max-w-xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-auto overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#222D20] pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center shrink-0">
                  <FileCheck className="w-4 h-4 text-[#A3C686]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-[#F3F7F1] truncate font-display">
                    Watermark Removed &amp; HD Enhanced
                  </h3>
                  <p className="text-[11px] sm:text-xs text-[#9AA895] truncate">
                    {latestResult.originalWidth}×{latestResult.originalHeight}px
                    {latestResult.durationSec
                      ? ` · Full ${latestResult.durationSec}s Video + Audio`
                      : ' · Lossless HD Photo'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCompletionModal(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-xl bg-[#1A2218] border border-[#2C3A29] text-[#A9B8A4] hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Interactive Before & After Comparison Slider */}
            <BeforeAfterMediaSlider
              kind={latestResult.kind}
              beforeUrl={latestResult.originalFileUrl}
              afterUrl={latestResult.outputUrl}
              fallbackBeforeUrl={latestResult.originalDownloadUrl}
              fallbackAfterUrl={latestResult.outputDownloadUrl}
              altText={latestResult.fileName}
              maxHeightClass="max-h-[280px]"
            />

            {/* Quality Comparison Summary */}
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2.5 sm:p-3 rounded-xl bg-[#0C100B] border border-[#232E21] space-y-0.5 min-w-0">
                <div className="text-[11px] text-[#8FA38B]">Before (Original)</div>
                <div className="font-semibold text-[#E2EDE0] truncate">
                  {latestResult.originalFileName}
                </div>
                <div className="font-mono text-[11px] text-[#7D9179] truncate">
                  {latestResult.originalWidth}×{latestResult.originalHeight} · {formatBytes(latestResult.originalSizeBytes)}
                </div>
              </div>

              <div className="p-2.5 sm:p-3 rounded-xl bg-[#162014] border border-[#42583D] space-y-0.5 min-w-0">
                <div className="text-[11px] text-[#A3C686] font-semibold">After (Clean + HD)</div>
                <div className="font-semibold text-[#F1F5F0] truncate">
                  {latestResult.fileName}
                </div>
                <div className="font-mono text-[11px] text-[#C6E2B1] truncate">
                  {latestResult.originalWidth}×{latestResult.originalHeight} · {formatBytes(latestResult.outputSizeBytes)}
                </div>
              </div>
            </div>

            {/* Two Choice Buttons: Download Original vs Download Watermark-Free */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    latestResult.originalFileUrl,
                    latestResult.originalDownloadUrl,
                    latestResult.originalFileName
                  )
                }
                className="py-3 px-4 rounded-xl bg-[#1A2218] hover:bg-[#232F20] border border-[#344631] text-[#E6F0E0] font-bold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#A3C686] shrink-0" />
                <span>Download Original</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadCleaned(latestResult)}
                className="py-3 px-4 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer shadow-lg"
              >
                {downloadProgressPct !== null ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    <span>Saving ({downloadProgressPct}%)...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Download Watermark-Free</span>
                  </>
                )}
              </button>
            </div>

            <div className="text-center pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setShowCompletionModal(false);
                  setTimeout(() => {
                    if (cardPlayerVideoRef.current) {
                      cardPlayerVideoRef.current.muted = false;
                      cardPlayerVideoRef.current.volume = 1.0;
                      cardPlayerVideoRef.current.play().catch(() => {
                        if (cardPlayerVideoRef.current) {
                          cardPlayerVideoRef.current.muted = true;
                          cardPlayerVideoRef.current.play().catch(() => {});
                        }
                      });
                    }
                  }, 100);
                }}
                className="text-xs text-[#A3C686] hover:text-white font-semibold underline underline-offset-4 cursor-pointer"
              >
                Close &amp; Play Inside Studio Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
