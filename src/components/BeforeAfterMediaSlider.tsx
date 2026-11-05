import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  SlidersHorizontal,
  Eye,
} from 'lucide-react';
import { MediaKind } from '../types/media';

interface BeforeAfterMediaSliderProps {
  kind: MediaKind;
  beforeUrl: string;
  afterUrl: string;
  fallbackBeforeUrl?: string;
  fallbackAfterUrl?: string;
  altText?: string;
  maxHeightClass?: string;
}

export const BeforeAfterMediaSlider: React.FC<BeforeAfterMediaSliderProps> = ({
  kind,
  beforeUrl,
  afterUrl,
  fallbackBeforeUrl,
  fallbackAfterUrl,
  altText = 'Processed Media',
  maxHeightClass = 'max-h-[320px]',
}) => {
  const [sliderPct, setSliderPct] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'slider' | 'player'>('slider');

  // Video playback state for synchronized Before/After video comparison
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const afterVideoRef = useRef<HTMLVideoElement | null>(null);
  const beforeVideoRef = useRef<HTMLVideoElement | null>(null);

  const updateSliderFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rawPct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPct(Math.max(2, Math.min(98, Number(rawPct.toFixed(1)))));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (viewMode !== 'slider') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || viewMode !== 'slider') return;
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDragging(false);
    }
  };

  // Keep Before video time-synced with the master After video (which carries the full stereo audio)
  const syncBeforeVideo = useCallback(() => {
    const afterVid = afterVideoRef.current;
    const beforeVid = beforeVideoRef.current;
    if (!afterVid || !beforeVid) return;

    if (Math.abs(beforeVid.currentTime - afterVid.currentTime) > 0.18) {
      try {
        beforeVid.currentTime = afterVid.currentTime;
      } catch {
        // Ignore seek errors while loading
      }
    }
  }, []);

  useEffect(() => {
    if (kind !== 'video') return;
    const afterVid = afterVideoRef.current;
    const beforeVid = beforeVideoRef.current;
    if (!afterVid) return;

    afterVid.muted = isMuted;
    afterVid.volume = 1.0;
    if (beforeVid) {
      beforeVid.muted = true;
    }
  }, [kind, isMuted, viewMode]);

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const afterVid = afterVideoRef.current;
    const beforeVid = beforeVideoRef.current;
    if (!afterVid) return;

    if (afterVid.paused) {
      afterVid.muted = isMuted;
      afterVid.volume = 1.0;
      afterVid.play().catch(() => {});
      beforeVid?.play().catch(() => {});
      setIsPlaying(true);
    } else {
      afterVid.pause();
      beforeVid?.pause();
      setIsPlaying(false);
    }
  };

  const handleToggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const afterVid = afterVideoRef.current;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (afterVid) {
      afterVid.muted = nextMuted;
      if (!nextMuted) afterVid.volume = 1.0;
    }
  };

  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    const afterVid = afterVideoRef.current;
    const beforeVid = beforeVideoRef.current;
    if (!afterVid) return;
    afterVid.currentTime = 0;
    if (beforeVid) beforeVid.currentTime = 0;
    afterVid.play().catch(() => {});
    beforeVid?.play().catch(() => {});
    setIsPlaying(true);
  };

  const formatTime = (sec: number) => {
    if (!sec || !Number.isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-2.5">
      {/* Top Mode Switcher Bar: Before/After Interactive Slider vs Full Player */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C6E2B1]">
          <Sparkles className="w-3.5 h-3.5 text-[#A3C686]" />
          <span>
            {viewMode === 'slider'
              ? 'Swipe Left/Right to Compare Before & After HD Enhancement'
              : 'Full HD Enhanced Preview Player'}
          </span>
        </div>

        <div className="inline-flex items-center gap-1 bg-[#0E130D] border border-[#283425] rounded-xl p-1">
          <button
            type="button"
            onClick={() => setViewMode('slider')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'slider'
                ? 'bg-[#84A96A] text-[#0B0F0A]'
                : 'text-[#A9B8A4] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Before / After Slider</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('player')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'player'
                ? 'bg-[#84A96A] text-[#0B0F0A]'
                : 'text-[#A9B8A4] hover:text-white'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Full Player</span>
          </button>
        </div>
      </div>

      {/* Media Viewport */}
      {viewMode === 'player' ? (
        <div
          className={`rounded-2xl overflow-hidden border border-[#2E3C2B] bg-black ${maxHeightClass} flex items-center justify-center`}
        >
          {kind === 'video' ? (
            <video
              src={afterUrl || fallbackAfterUrl}
              controls
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                e.currentTarget.muted = false;
                e.currentTarget.volume = 1.0;
              }}
              onError={(e) => {
                if (
                  fallbackAfterUrl &&
                  e.currentTarget.src !== fallbackAfterUrl &&
                  !e.currentTarget.src.endsWith(fallbackAfterUrl)
                ) {
                  e.currentTarget.src = fallbackAfterUrl;
                }
              }}
              className={`${maxHeightClass} w-full object-contain block`}
            />
          ) : (
            <img
              src={afterUrl || fallbackAfterUrl}
              alt={altText}
              referrerPolicy="no-referrer"
              className={`${maxHeightClass} w-full object-contain block`}
            />
          )}
        </div>
      ) : (
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`relative rounded-2xl overflow-hidden border border-[#384B34] bg-black ${maxHeightClass} flex items-center justify-center select-none touch-none cursor-ew-resize`}
        >
          {kind === 'video' ? (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Base Layer: AFTER (Watermark-Free + HD Enhanced with Stereo Audio) */}
              <video
                ref={afterVideoRef}
                src={afterUrl || fallbackAfterUrl}
                autoPlay
                loop
                playsInline
                onLoadedMetadata={(e) => {
                  e.currentTarget.muted = isMuted;
                  e.currentTarget.volume = 1.0;
                  setDuration(e.currentTarget.duration || 0);
                }}
                onTimeUpdate={(e) => {
                  setCurrentTime(e.currentTarget.currentTime);
                  syncBeforeVideo();
                }}
                onPlay={() => {
                  setIsPlaying(true);
                  beforeVideoRef.current?.play().catch(() => {});
                }}
                onPause={() => {
                  setIsPlaying(false);
                  beforeVideoRef.current?.pause();
                }}
                onSeeking={syncBeforeVideo}
                onError={(e) => {
                  if (
                    fallbackAfterUrl &&
                    e.currentTarget.src !== fallbackAfterUrl &&
                    !e.currentTarget.src.endsWith(fallbackAfterUrl)
                  ) {
                    e.currentTarget.src = fallbackAfterUrl;
                  }
                }}
                className={`${maxHeightClass} w-full object-contain block pointer-events-none`}
              />

              {/* Top Clipped Layer: BEFORE (Original with Watermark, Muted & Synced) */}
              <video
                ref={beforeVideoRef}
                src={beforeUrl || fallbackBeforeUrl}
                autoPlay
                loop
                muted
                playsInline
                onError={(e) => {
                  if (
                    fallbackBeforeUrl &&
                    e.currentTarget.src !== fallbackBeforeUrl &&
                    !e.currentTarget.src.endsWith(fallbackBeforeUrl)
                  ) {
                    e.currentTarget.src = fallbackBeforeUrl;
                  }
                }}
                style={{
                  clipPath: `inset(0 ${100 - sliderPct}% 0 0)`,
                }}
                className={`absolute inset-0 ${maxHeightClass} w-full h-full object-contain block pointer-events-none`}
              />
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Base Layer: AFTER (Watermark-Free + HD Enhanced Photo) */}
              <img
                src={afterUrl || fallbackAfterUrl}
                alt={`${altText} (After)`}
                referrerPolicy="no-referrer"
                className={`${maxHeightClass} w-full object-contain block pointer-events-none`}
              />

              {/* Top Clipped Layer: BEFORE (Original Photo) */}
              <img
                src={beforeUrl || fallbackBeforeUrl}
                alt={`${altText} (Before)`}
                referrerPolicy="no-referrer"
                style={{
                  clipPath: `inset(0 ${100 - sliderPct}% 0 0)`,
                }}
                className={`absolute inset-0 ${maxHeightClass} w-full h-full object-contain block pointer-events-none`}
              />
            </div>
          )}

          {/* BEFORE / AFTER Floating Corner Labels */}
          <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
            <span className="px-2.5 py-1 rounded-lg bg-black/75 border border-white/15 text-[11px] font-bold text-[#D5E3CE] tracking-wide uppercase backdrop-blur-sm">
              Before (Original)
            </span>
          </div>

          <div className="absolute top-2.5 right-2.5 z-10 pointer-events-none">
            <span className="px-2.5 py-1 rounded-lg bg-[#151B14]/90 border border-[#84A96A] text-[11px] font-bold text-[#A3C686] tracking-wide uppercase backdrop-blur-sm flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              <span>After (Clean + HD Enhanced)</span>
            </span>
          </div>

          {/* Interactive Split Line & Touch Handle */}
          <div
            style={{ left: `${sliderPct}%` }}
            className="absolute inset-y-0 z-20 w-0.5 bg-[#A3C686] shadow-[0_0_12px_rgba(163,198,134,0.9)] pointer-events-none"
          >
            <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#84A96A] border-2 border-[#0B0F0A] shadow-xl flex items-center justify-center text-[#0B0F0A] font-bold text-xs">
              ‹›
            </div>
          </div>

          {/* Video Transport & Audio Bar at Bottom of Slider */}
          {kind === 'video' && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute bottom-2.5 left-2.5 right-2.5 z-30 flex items-center justify-between gap-2 bg-[#0E130D]/90 border border-[#2C3A29] backdrop-blur-md px-3 py-1.5 rounded-xl text-xs"
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="px-2.5 py-1 rounded-lg bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Play</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="px-2 py-1 rounded-lg bg-[#1B2319] hover:bg-[#253022] border border-[#32422F] text-[#E6F2DC] inline-flex items-center gap-1 cursor-pointer"
                  title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                >
                  {isMuted ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-[#F87171]" />
                      <span className="hidden sm:inline">Muted</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-[#A3C686]" />
                      <span className="hidden sm:inline">Sound On</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleRestart}
                  className="p-1 rounded-lg bg-[#1B2319] hover:bg-[#253022] border border-[#32422F] text-[#D5E3CE] cursor-pointer"
                  title="Replay"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="font-mono text-[11px] text-[#C6D4C0] tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
