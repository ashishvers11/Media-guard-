export type MediaKind = 'photo' | 'video';

export interface WatermarkBox {
  id: string;
  label: string;
  /** X position as percentage of media width (0 - 100) */
  xPct: number;
  /** Y position as percentage of media height (0 - 100) */
  yPct: number;
  /** Width as percentage of media width (2 - 60) */
  wPct: number;
  /** Height as percentage of media height (2 - 60) */
  hPct: number;
}

export type ProcessingStage =
  | 'idle'
  | 'analyzing'
  | 'detecting-ai'
  | 'inpainting'
  | 'encoding'
  | 'completed'
  | 'error';

export interface ProcessingProgress {
  stage: ProcessingStage;
  percent: number;
  statusText: string;
  currentFrame?: number;
  totalFrames?: number;
  fps?: number;
  elapsedMs?: number;
}

export interface HistoryRecord {
  id: string;
  originalFileName: string;
  originalFileUrl: string;
  originalDownloadUrl: string;
  fileName: string;
  kind: MediaKind;
  originalWidth: number;
  originalHeight: number;
  originalSizeBytes: number;
  outputSizeBytes: number;
  outputMimeType: string;
  outputUrl: string;
  outputDownloadUrl: string;
  originalPreviewUrl: string;
  cleanedPreviewUrl: string;
  detectedType: string;
  confidence: number;
  regionsCount: number;
  durationSec?: number;
  processedAt: string;
  processingTimeMs: number;
  inpaintMode: 'telea-harmonic' | 'patch-texture' | 'adaptive-blend';
}

export interface UserRequirementsConfig {
  isConfigured: boolean;
  ownerName: string;
  businessTitle: string;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string;
  locationText: string;
  workingHours: string;
  customServiceNote: string;
  preferredExportFormat: 'original' | 'png' | 'webp' | 'mp4';
  defaultWatermarkPreset: 'bottom-right-gemini' | 'bottom-left-badge' | 'top-right' | 'auto-ai';
  cardUiVariant: 'style-a-inset' | 'style-b-split';
}

export interface ContactSubmission {
  id: string;
  senderName: string;
  senderEmail: string;
  mediaTypeNeeded: string;
  message: string;
  submittedAt: string;
}
