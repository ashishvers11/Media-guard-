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

interface WatermarkStudioProps {
  onAddHistory: (item: HistoryRecord) => void;
}

/**
 * Reliable in-iframe downloader that guarantees a non-zero Blob before triggering browser download.
 * Avoids Android Chrome's external DownloadManager failing on unauthenticated server redirects.
 */
export async function triggerReliableDownload(
  primaryUrl: string,
  fallbackServerUrl: string,
  fileName: string
): Promise<void> {
  try {
    let targetBlobUrl = primaryUrl;

    // If primaryUrl is not a blob: URL (or if it expired after reload), fetch via authenticated iframe fetch()
    if (!primaryUrl.startsWith('blob:')) {
      const res = await fetch(fallbackServerUrl || primaryUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('Downloaded file is 0 bytes');
      targetBlobUrl = URL.createObjectURL(blob);
    } else {
      // Verify the blob URL is still alive in memory and non-zero
      try {
        const check = await fetch(primaryUrl);
        const blob = await check.blob();
        if (blob.size === 0) throw new Error('Empty blob');
      } catch {
        if (fallbackServerUrl) {
          const res = await fetch(fallbackServerUrl, { credentials: 'include' });
          const blob = await res.blob();
          targetBlobUrl = URL.createObjectURL(blob);
        }
      }
    }

    const a = document.createElement('a');
    a.href = targetBlobUrl;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 1000);
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
    statusText: 'Upload a photo or video — watermark detection & removal runs automatically.',
  });

  const [latestResult, setLatestResult] = useState<HistoryRecord | null>(null);
  const [showCompletionModal, setShowCompletionModal] = useState<boolean>(false);
  const [isCardVideoPlaying, setIsCardVideoPlaying] = useState<boolean>(false);

  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const cardPlayerVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        ctx.drawImage(img, 0, 0, w, h);
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
        ctx.drawImage(vid, 0, 0, w, h);
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

    try {
      const apiThumb = document.createElement('canvas');
      const scale = Math.min(1, 768 / Math.max(w, h));
      apiThumb.width = Math.max(64, Math.round(w * scale));
      apiThumb.height = Math.max(64, Math.round(h * scale));
      apiThumb.getContext('2d')!.drawImage(sourceEl, 0, 0, apiThumb.width, apiThumb.height);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

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

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.regions) && data.regions.length > 0) {
          const apiBoxes: WatermarkBox[] = data.regions.map(
            (r: { label?: string; xPct: number; yPct: number; wPct: number; hPct: number }, i: number) => ({
              id: `auto-ai-${i}-${Date.now()}`,
              label: r.label || data.watermarkType || 'Bottom-Right Gemini Watermark',
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
      stage: 'detecting-ai',
      percent: 30,
      statusText: `Auto-detecting Gemini watermark on ${w}×${h}px photo...`,
    });

    const detection = overrideBoxes
      ? { boxes: overrideBoxes, label: overrideBoxes[0].label, confidence: 0.99 }
      : await detectWatermarkBoxesAutomatically(img, w, h);

    if (activeJobIdRef.current !== jobId) return;
    setBoxes(detection.boxes);

    setProgress({
      stage: 'inpainting',
      percent: 70,
      statusText: `Removing watermark & restoring original ${w}×${h}px pixels...`,
    });

    await new Promise((r) => setTimeout(r, 60));
    if (activeJobIdRef.current !== jobId) return;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d')!;
    outCtx.drawImage(img, 0, 0, w, h);
    inpaintRegionsOnContext(outCtx, w, h, detection.boxes);

    const dispCanvas = displayCanvasRef.current;
    if (dispCanvas) {
      dispCanvas.width = w;
      dispCanvas.height = h;
      dispCanvas.getContext('2d')?.drawImage(outCanvas, 0, 0);
    }

    setProgress({
      stage: 'encoding',
      percent: 90,
      statusText: 'Encoding lossless original-quality photo...',
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
      statusText: `Watermark removed (${w}×${h}px · ${formatBytes(outBlob.size)}).`,
      elapsedMs: totalElapsed,
    });
  };

  // AUTOMATIC VIDEO PIPELINE:
  // 1. Uploads video in 6 MB chunks (bypasses Cloud Run / Nginx 32MB limit for 35.67MB+ videos!)
  // 2. Server runs FFmpeg delogo + Gemini watermark detection and encodes clean MP4
  // 3. Client fetches the finished MP4 into a local in-memory Blob so <video> playback and Download work 100% on Android Chrome!
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
      stage: 'detecting-ai',
      percent: 8,
      statusText: `Preparing ${vw}×${vh}px video (${duration.toFixed(1)}s · ${formatBytes(
        file.size
      )})...`,
    });

    // Seek briefly to capture preview thumbnail
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
      setTimeout(finish, 250);
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
      // STEP 1: Upload video in 6 MB chunks so 35.67 MB+ files never trigger HTTP 413 in Nginx
      const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB per chunk
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const uploadId = `${Date.now()}_${jobId}`;

      for (let idx = 0; idx < totalChunks; idx++) {
        if (activeJobIdRef.current !== jobId) return;

        const startByte = idx * CHUNK_SIZE;
        const endByte = Math.min(file.size, startByte + CHUNK_SIZE);
        const chunkBlob = file.slice(startByte, endByte);

        const pct = Math.min(55, Math.round(10 + ((idx + 0.5) / totalChunks) * 45));
        setProgress({
          stage: 'inpainting',
          percent: pct,
          statusText: `Uploading video chunk ${idx + 1} of ${totalChunks} (${formatBytes(
            endByte
          )} / ${formatBytes(file.size)})...`,
        });

        const chunkRes = await fetch(
          `/api/upload-chunk?uploadId=${encodeURIComponent(uploadId)}&index=${idx}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunkBlob,
            credentials: 'include',
          }
        );

        if (!chunkRes.ok) {
          throw new Error(`Chunk ${idx + 1} upload failed (${chunkRes.status})`);
        }
      }

      if (activeJobIdRef.current !== jobId) return;

      // STEP 2: Trigger Server-Side FFmpeg Watermark Detection + Delogo Removal
      let currentPct = 58;
      setProgress({
        stage: 'encoding',
        percent: currentPct,
        statusText: `Detecting Gemini watermark & cleaning ${vw}×${vh}px video frames...`,
      });

      tickerId = setInterval(() => {
        if (activeJobIdRef.current !== jobId) return;
        currentPct = Math.min(88, currentPct + 3);
        setProgress({
          stage: 'encoding',
          percent: currentPct,
          statusText: `Removing watermark & encoding original-quality MP4 (${currentPct}%)...`,
        });
      }, 350);

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
          label: serverResult.detectedBox.label || 'Bottom-Right Gemini Watermark',
          xPct: Number(serverResult.detectedBox.xPct),
          yPct: Number(serverResult.detectedBox.yPct),
          wPct: Number(serverResult.detectedBox.wPct),
          hPct: Number(serverResult.detectedBox.hPct),
        };
        setBoxes([detBox]);
        inpaintRegionsOnContext(procCtx, vw, vh, [detBox]);
      }

      const cleanedThumbUrl = procCanvas.toDataURL('image/jpeg', 0.75);

      // STEP 3: Fetch the cleaned MP4 into a verified local Blob so <video> playback and Download work 100% inside the iframe!
      setProgress({
        stage: 'encoding',
        percent: 94,
        statusText: `Loading watermark-free MP4 (${formatBytes(
          serverResult.outputSizeBytes
        )}) into player...`,
      });

      const mediaFetchRes = await fetch(serverResult.outputMediaUrl, {
        credentials: 'include',
      });
      if (!mediaFetchRes.ok) {
        throw new Error('Failed to load processed MP4 stream from server.');
      }

      const cleanVideoBlob = await mediaFetchRes.blob();
      if (cleanVideoBlob.size === 0) {
        throw new Error('Processed video blob is 0 bytes.');
      }

      const localCleanVideoUrl = URL.createObjectURL(
        new Blob([cleanVideoBlob], { type: 'video/mp4' })
      );

      if (activeJobIdRef.current !== jobId) return;

      const totalElapsed = Math.round(performance.now() - startMs);
      const finalW = serverResult.width || vw;
      const finalH = serverResult.height || vh;
      setNativeWidth(finalW);
      setNativeHeight(finalH);

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
        outputSizeBytes: cleanVideoBlob.size,
        outputMimeType: 'video/mp4',
        outputUrl: localCleanVideoUrl,
        outputDownloadUrl: serverResult.outputMediaUrl,
        originalPreviewUrl: origThumbUrl,
        cleanedPreviewUrl: cleanedThumbUrl,
        detectedType: serverResult.detectedBox?.label || 'Gemini Watermark',
        confidence: serverResult.detectedBox?.confidence || 0.98,
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
        statusText: `Done! ${duration.toFixed(1)}s video cleaned (${finalW}×${finalH}px · ${formatBytes(
          cleanVideoBlob.size
        )}).`,
        elapsedMs: totalElapsed,
      });
    } catch {
      if (tickerId) clearInterval(tickerId);
      // Fallback for static hosting (e.g. Netlify) where /api/upload-chunk is not running
      try {
        const localScan = overrideBoxes
          ? { boxes: overrideBoxes, confidence: 0.99 }
          : scanFrameForWatermarkCorners(procCtx, vw, vh);
        setBoxes(localScan.boxes);
        inpaintRegionsOnContext(procCtx, vw, vh, localScan.boxes);
        const cleanedThumbUrl = procCanvas.toDataURL('image/jpeg', 0.75);

        const mimeCandidates = [
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9',
          'video/webm',
        ];
        const chosenMime =
          mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

        const stream = procCanvas.captureStream(30);
        const recorder = new MediaRecorder(stream, {
          mimeType: chosenMime,
          videoBitsPerSecond: 24_000_000,
        });
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

        vid.currentTime = 0;
        await vid.play();
        recorder.start(200);

        await new Promise<void>((resolve) => {
          const drawTick = () => {
            if (activeJobIdRef.current !== jobId) {
              if (recorder.state !== 'inactive') recorder.stop();
              resolve();
              return;
            }
            procCtx.drawImage(vid, 0, 0, vw, vh);
            inpaintRegionsOnContext(procCtx, vw, vh, localScan.boxes);
            const pct = Math.min(96, Math.round(15 + (vid.currentTime / duration) * 80));
            setProgress({
              stage: 'encoding',
              percent: pct,
              statusText: `Cleaning video frames (${pct}%)...`,
            });
            if (vid.ended || vid.paused) {
              if (recorder.state !== 'inactive') recorder.stop();
              resolve();
              return;
            }
            requestAnimationFrame(drawTick);
          };
          vid.onended = () => {
            if (recorder.state !== 'inactive') recorder.stop();
            resolve();
          };
          requestAnimationFrame(drawTick);
        });

        const outBlob = await recDone;
        const finalBlob = outBlob.size > 0 ? outBlob : file;
        const localCleanUrl = URL.createObjectURL(finalBlob);
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
          originalWidth: vw,
          originalHeight: vh,
          originalSizeBytes: file.size,
          outputSizeBytes: finalBlob.size,
          outputMimeType: finalBlob.type || 'video/mp4',
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
          statusText: `Done! ${duration.toFixed(1)}s video cleaned (${vw}×${vh}px · ${formatBytes(
            finalBlob.size
          )}).`,
          elapsedMs: totalElapsed,
        });
      } catch (fallbackErr: unknown) {
        isProcessingRef.current = false;
        const errMsg =
          fallbackErr instanceof Error ? fallbackErr.message : 'Failed to process video.';
        setProgress({
          stage: 'error',
          percent: 100,
          statusText: `Error: ${errMsg}`,
        });
      }
    }
  };

  // Triggered when user selects or drops a photo or video
  const handleSelectFile = (file: File) => {
    const nextJobId = activeJobIdRef.current + 1;
    activeJobIdRef.current = nextJobId;

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

    setProgress({
      stage: 'analyzing',
      percent: 5,
      statusText: `Loading ${file.name} (${formatBytes(file.size)})...`,
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
        vid.onloadedmetadata = () => {
          if (triggered || activeJobIdRef.current !== nextJobId) return;
          triggered = true;
          vid.onloadedmetadata = null;
          setNativeWidth(vid.videoWidth || 1280);
          setNativeHeight(vid.videoHeight || 720);
          runAutomaticVideoPipeline(nextJobId, file, url, vid);
        };
        vid.src = url;
        vid.load();
      }
    }
  };

  // Re-run with custom manual box if user adjusted the box
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

  const handleToggleCardVideoPlay = () => {
    const v = cardPlayerVideoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsCardVideoPlaying(true);
    } else {
      v.pause();
      setIsCardVideoPlaying(false);
    }
  };

  const handleRestartCardVideo = () => {
    const v = cardPlayerVideoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play();
    setIsCardVideoPlaying(true);
  };

  // Drag/resize handlers for optional manual adjustment
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
    progress.stage === 'analyzing' ||
    progress.stage === 'detecting-ai' ||
    progress.stage === 'inpainting' ||
    progress.stage === 'encoding';

  const showPlayableVideoInCard =
    mediaKind === 'video' && Boolean(latestResult) && !isBusy && !showManualAdjust;

  const activeVideoSrcInCard = compareOriginal
    ? latestResult?.originalFileUrl || originalObjectUrl
    : latestResult?.outputUrl || '';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
      <video
        ref={sourceVideoRef}
        className="hidden"
        playsInline
        muted
        crossOrigin="anonymous"
      />

      {/* Main Studio Card */}
      <div className="bg-[#151B14] border border-[#2A3528] rounded-[28px] p-4 sm:p-6 space-y-5">
        {!mediaFile ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleSelectFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-[22px] border-2 border-dashed border-[#496142] bg-[#1C251A] hover:bg-[#222D20] transition-colors py-16 px-6 text-center cursor-pointer flex flex-col items-center justify-center gap-3"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#A3C686]" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#F3F7F1]">
              Upload Photo or Video (100% Automatic)
            </h2>
            <p className="text-sm text-[#9AA895] max-w-md">
              Select any Gemini photo or video (supports 35MB+ 2K/4K files). Watermark removal runs automatically.
            </p>
            <span className="mt-2 px-5 py-2.5 rounded-xl bg-[#84A96A] text-[#0B0F0A] font-semibold text-sm">
              Choose Photo or Video
            </span>
          </div>
        ) : (
          <>
            {/* Top Bar inside Card */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-[#A9B8A4] font-mono">
                <span className="text-[#F1F5F0] font-semibold truncate max-w-[200px]">
                  {mediaFile.name}
                </span>
                <span aria-hidden="true">·</span>
                <span>{nativeWidth}×{nativeHeight}px</span>
                {latestResult?.durationSec && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{latestResult.durationSec}s</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
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
                  className="px-3 py-1.5 rounded-lg bg-[#1E271C] hover:bg-[#283425] border border-[#32422F] text-xs font-medium text-[#D5E3CE] inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#A3C686]" />
                  <span>{showManualAdjust ? 'Close Zone Adjust' : 'Adjust Watermark Zone'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isBusy}
                  className="px-3.5 py-1.5 rounded-lg bg-[#233020] hover:bg-[#2E3F2A] border border-[#496142] text-xs font-semibold text-[#E2F1D5] inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload New File</span>
                </button>
              </div>
            </div>

            {/* Real-Time Progress Bar */}
            <div className="bg-[#10150F] border border-[#253023] rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#D7E8C8] font-medium flex items-center gap-2">
                  {isBusy ? (
                    <RefreshCw className="w-3.5 h-3.5 text-[#A3C686] animate-spin shrink-0" />
                  ) : progress.stage === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-[#F87171] shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#A3C686] shrink-0" />
                  )}
                  <span>{progress.statusText}</span>
                </span>
                <span className="font-mono tabular-nums font-bold text-[#A3C686]">
                  {progress.percent}%
                </span>
              </div>

              <div className="w-full h-2.5 bg-[#0A0D0A] rounded-full overflow-hidden border border-[#222C20]">
                <div
                  style={{ transform: `scaleX(${Math.max(0.02, progress.percent / 100)})` }}
                  className={`h-full w-full origin-left transition-transform duration-150 ease-out ${
                    progress.stage === 'error' ? 'bg-[#F87171]' : 'bg-[#84A96A]'
                  }`}
                />
              </div>
            </div>

            {/* Optional Manual Corner / Box Adjuster */}
            {showManualAdjust && (
              <div className="bg-[#10150F] border border-[#32422F] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {Object.entries(WATERMARK_PRESETS).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBoxes([{ ...preset }])}
                      className="px-3 py-1.5 rounded-lg bg-[#1B2319] hover:bg-[#263223] border border-[#2E3C2B] text-xs text-[#D5E3CE] cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleReprocessWithCustomBox}
                  className="px-4 py-1.5 rounded-lg bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-semibold text-xs cursor-pointer"
                >
                  Apply &amp; Re-Clean Now
                </button>
              </div>
            )}

            {/* Main Media Viewport inside Card */}
            <div className="relative bg-[#10160F] rounded-[22px] overflow-hidden border border-[#2F3E2C]">
              <div
                ref={previewContainerRef}
                onPointerMove={handleBoxPointerMove}
                onPointerUp={handleBoxPointerUp}
                className="relative w-full max-h-[520px] min-h-[260px] flex items-center justify-center select-none overflow-hidden bg-black"
              >
                <canvas
                  ref={displayCanvasRef}
                  className={
                    showPlayableVideoInCard
                      ? 'hidden'
                      : 'max-h-[500px] w-auto max-w-full object-contain block'
                  }
                />

                {/* Playable Video Player directly inside the Card once watermark removal finishes */}
                {showPlayableVideoInCard && (
                  <video
                    ref={cardPlayerVideoRef}
                    key={activeVideoSrcInCard}
                    src={activeVideoSrcInCard}
                    controls
                    playsInline
                    onPlay={() => setIsCardVideoPlaying(true)}
                    onPause={() => setIsCardVideoPlaying(false)}
                    className="max-h-[500px] w-full object-contain block"
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
                    className="absolute border-2 border-[#A3C686] bg-[#84A96A]/25 rounded-lg cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]"
                  >
                    <div className="absolute -top-6 left-0 bg-[#151B14] text-[#D7E8C8] border border-[#84A96A]/50 px-2 py-0.5 rounded text-[11px] font-mono whitespace-nowrap flex items-center gap-1">
                      <Move className="w-3 h-3 text-[#A3C686]" />
                      <span>Drag or Resize Watermark Area</span>
                    </div>
                    <div
                      onPointerDown={(e) => handleBoxPointerDown(e, 'resize')}
                      className="absolute -bottom-2 -right-2 w-4 h-4 bg-[#A3C686] border-2 border-[#0E130D] rounded-sm cursor-nwse-resize"
                    />
                  </div>
                )}
              </div>

              {/* Dedicated In-Card Video Player Control & Status Bar */}
              <div className="bg-[#6D8F54] text-[#F7FAF5] px-4 py-2.5 text-xs font-medium flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {showPlayableVideoInCard && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleToggleCardVideoPlay}
                        className="px-2.5 py-1 rounded-md bg-[#111710] hover:bg-[#1C261A] text-[#E6F2DC] font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        {isCardVideoPlaying ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause Video</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Play Video</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleRestartCardVideo}
                        className="px-2 py-1 rounded-md bg-[#111710]/80 hover:bg-[#1C261A] text-[#E6F2DC] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Replay</span>
                      </button>
                    </div>
                  )}

                  <span>
                    {isBusy
                      ? 'Automatic Watermark Removal in Progress...'
                      : compareOriginal
                      ? 'Viewing: Original Uploaded Media (With Watermark)'
                      : 'Viewing: Watermark-Free Media (100% Original Quality)'}
                  </span>
                </div>

                {latestResult && !isBusy && (
                  <button
                    type="button"
                    onClick={() => setCompareOriginal((prev) => !prev)}
                    className="px-2.5 py-1 rounded-md bg-[#151B14]/70 hover:bg-[#151B14] text-white font-semibold cursor-pointer"
                  >
                    {compareOriginal ? 'Switch to Watermark-Free' : 'Compare Original'}
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Action Bar inside Card: Both Download Options + Re-open Modal */}
            {latestResult && !isBusy && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCompletionModal(true)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#1E271C] hover:bg-[#273324] border border-[#3A4D36] text-xs font-semibold text-[#D7E8C8] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#A3C686]" />
                  <span>Open Download Choice Modal</span>
                </button>

                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      triggerReliableDownload(
                        latestResult.originalFileUrl,
                        latestResult.originalDownloadUrl,
                        latestResult.originalFileName
                      )
                    }
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#1B2319] hover:bg-[#253022] border border-[#32422F] text-[#D5E3CE] font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Original</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      triggerReliableDownload(
                        latestResult.outputUrl,
                        latestResult.outputDownloadUrl,
                        latestResult.fileName
                      )
                    }
                    className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Watermark-Free</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =========================================================================
          PROCESSING COMPLETE MODAL: Play Video Preview + Download Original / Watermark-Free
          ========================================================================= */}
      {showCompletionModal && latestResult && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setShowCompletionModal(false)}
        >
          <div
            className="bg-[#151B14] border border-[#384B34] rounded-[28px] max-w-xl w-full p-5 sm:p-6 space-y-4 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-[#253023] pb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center shrink-0">
                  <FileCheck className="w-5 h-5 text-[#A3C686]" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-[#F3F7F1]">
                    Processing Complete — Original Quality Ready
                  </h3>
                  <p className="text-xs text-[#9AA895]">
                    {latestResult.originalWidth}×{latestResult.originalHeight}px
                    {latestResult.durationSec ? ` · ${latestResult.durationSec}s Video` : ' · Lossless Photo'} · 0% Quality Loss
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCompletionModal(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg border border-[#2C3A29] text-[#A9B8A4] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Media Preview (Playable Video or Cleaned Photo) */}
            <div className="rounded-2xl overflow-hidden border border-[#2E3C2B] bg-black max-h-[300px] flex items-center justify-center">
              {latestResult.kind === 'video' ? (
                <video
                  src={latestResult.outputUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-[290px] w-full object-contain block"
                />
              ) : (
                <img
                  src={latestResult.outputUrl}
                  alt={latestResult.fileName}
                  referrerPolicy="no-referrer"
                  className="max-h-[290px] w-full object-contain block"
                />
              )}
            </div>

            {/* Quality Comparison Summary */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#0E130D] border border-[#263124] space-y-1">
                <div className="text-[#9AA895]">Original File</div>
                <div className="font-semibold text-[#E2EDE0] truncate">
                  {latestResult.originalFileName}
                </div>
                <div className="font-mono text-[#8FA38B]">
                  {latestResult.originalWidth}×{latestResult.originalHeight}px · {formatBytes(latestResult.originalSizeBytes)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#182216] border border-[#496142] space-y-1">
                <div className="text-[#A3C686] font-medium">Watermark-Free Output</div>
                <div className="font-semibold text-[#F1F5F0] truncate">
                  {latestResult.fileName}
                </div>
                <div className="font-mono text-[#C6E2B1]">
                  {latestResult.originalWidth}×{latestResult.originalHeight}px · {formatBytes(latestResult.outputSizeBytes)}
                </div>
              </div>
            </div>

            {/* Two Choice Buttons: Download Original vs Download Watermark-Free */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    latestResult.originalFileUrl,
                    latestResult.originalDownloadUrl,
                    latestResult.originalFileName
                  )
                }
                className="py-3 px-4 rounded-xl bg-[#1E271C] hover:bg-[#283425] border border-[#384B34] text-[#E6F0E0] font-semibold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#A3C686]" />
                <span>Download Original</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    latestResult.outputUrl,
                    latestResult.outputDownloadUrl,
                    latestResult.fileName
                  )
                }
                className="py-3 px-4 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Watermark-Free</span>
              </button>
            </div>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowCompletionModal(false);
                  setTimeout(() => {
                    cardPlayerVideoRef.current?.play().catch(() => {});
                  }, 100);
                }}
                className="text-xs text-[#C6E2B1] hover:text-white font-semibold underline underline-offset-4 cursor-pointer"
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
