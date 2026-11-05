import React, { useState, useEffect } from 'react';
import {
  Download,
  Trash2,
  Menu,
  X,
  Play,
  Headset,
  ExternalLink,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { HistoryRecord } from './types/media';
import { WatermarkStudio, triggerReliableDownload } from './components/WatermarkStudio';
import { BeforeAfterMediaSlider } from './components/BeforeAfterMediaSlider';

const STORAGE_KEY_HISTORY = 'mediaguard_processing_history_v4';
const STORAGE_KEY_CHANNEL_POPUP = 'mediaguard_channel_popup_seen_v1';

const TELEGRAM_CHANNEL_URL = 'https://t.me/+TAbMK2L7iMBkMDQ1';
const TELEGRAM_SUPPORT_URL = 'https://t.me/loserxash';

export default function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previewHistoryItem, setPreviewHistoryItem] = useState<HistoryRecord | null>(null);

  // First-time Join Telegram Channel Popup (only opens on 1st visit)
  const [showChannelPopup, setShowChannelPopup] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CHANNEL_POPUP) !== 'true';
    } catch {
      return true;
    }
  });

  const handleCloseChannelPopup = () => {
    setShowChannelPopup(false);
    try {
      localStorage.setItem(STORAGE_KEY_CHANNEL_POPUP, 'true');
    } catch {
      // Ignore storage errors
    }
  };

  // Automatically filter out any broken 0-byte items from previous sessions
  const [history, setHistory] = useState<HistoryRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (!saved) return [];
      const parsed: HistoryRecord[] = JSON.parse(saved);
      return Array.isArray(parsed)
        ? parsed.filter((item) => item && item.outputSizeBytes > 0)
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch {
      // Ignore quota
    }
  }, [history]);

  // Strictly deduplicate by id and originalFileName and reject 0-byte entries
  const handleAddHistory = (item: HistoryRecord) => {
    if (!item || item.outputSizeBytes <= 0) return;
    setHistory((prev) => {
      const filtered = prev.filter(
        (existing) =>
          existing.outputSizeBytes > 0 &&
          existing.id !== item.id &&
          !(existing.originalFileName === item.originalFileName && existing.kind === item.kind)
      );
      const updated = [item, ...filtered].slice(0, 25);
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
      } catch {
        // Ignore blob storage limits
      }
      return updated;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
    } catch {
      // Ignore
    }
  };

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#090C09] text-[#F2F6F0] flex flex-col">
      {/* =========================================================
          FIRST-TIME JOIN CHANNEL POPUP (https://t.me/+TAbMK2L7iMBkMDQ1)
          ========================================================= */}
      {showChannelPopup && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={handleCloseChannelPopup}
        >
          <div
            className="relative bg-[#121811] border border-[#344631] rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl text-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cut / Close Button */}
            <button
              type="button"
              onClick={handleCloseChannelPopup}
              aria-label="Close popup"
              className="absolute top-4 right-4 p-2 rounded-xl bg-[#1A2218] hover:bg-[#243021] border border-[#2E3C2B] text-[#A9B8A4] hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Channel Icon */}
            <div className="w-15 h-15 mx-auto rounded-2xl bg-[#84A96A]/15 border border-[#84A96A]/70 flex items-center justify-center">
              <Send className="w-7 h-7 text-[#A3C686]" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-[#F3F7F1] font-display tracking-tight">
                Join Official Telegram Channel
              </h2>
              <p className="text-xs sm:text-sm text-[#9AA895] leading-relaxed">
                Get latest updates, tools, and direct announcements on our official Telegram channel.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <a
                href={TELEGRAM_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCloseChannelPopup}
                className="w-full py-3 px-5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-md"
              >
                <Send className="w-4 h-4" />
                <span>Join Telegram Channel</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={handleCloseChannelPopup}
                className="w-full py-2.5 px-4 rounded-xl bg-[#182016] hover:bg-[#222D1F] border border-[#2A3728] text-xs font-semibold text-[#A9B8A4] hover:text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header: MediaGuard + ONLY 3 Sections (Home, History, Contact) */}
      <header className="sticky top-0 z-40 w-full bg-[#090C09]/95 backdrop-blur-md border-b border-[#1D261B]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <a
            href="#home"
            className="inline-flex items-center gap-2 text-lg sm:text-xl font-extrabold tracking-tight text-[#F3F7F1] whitespace-nowrap shrink-0 font-display"
          >
            <span className="w-7 h-7 rounded-lg bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[#A3C686]" />
            </span>
            <span>MediaGuard</span>
          </a>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#A9B8A4]">
            <a
              href="#home"
              className="hover:text-[#F3F7F1] transition-colors whitespace-nowrap"
            >
              Home
            </a>
            <a
              href="#history"
              className="hover:text-[#F3F7F1] transition-colors whitespace-nowrap"
            >
              History ({history.length})
            </a>
            <a
              href="#contact"
              className="hover:text-[#F3F7F1] transition-colors whitespace-nowrap"
            >
              Contact
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href="#home"
              className="px-3.5 py-2 text-xs font-bold text-[#0B0F0A] bg-[#84A96A] hover:bg-[#95B97B] rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-sm"
            >
              Clean Media
            </a>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-xl bg-[#141B13] border border-[#2A3728] text-[#D5E3CE] hover:text-white cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#1D261B] bg-[#0F140E] px-4 py-3 space-y-1">
            <button
              type="button"
              onClick={() => scrollToSection('home')}
              className="block w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold text-[#D5E3CE] hover:bg-[#182016] hover:text-white"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('history')}
              className="block w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold text-[#D5E3CE] hover:bg-[#182016] hover:text-white"
            >
              History ({history.length})
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contact')}
              className="block w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold text-[#D5E3CE] hover:bg-[#182016] hover:text-white"
            >
              Contact
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {/* =========================================================
            1. HOME SECTION — AUTOMATIC WATERMARK REMOVER + HD ENHANCE
            ========================================================= */}
        <section id="home" className="py-7 sm:py-10 px-3.5 sm:px-6 border-b border-[#1A2218]">
          <div className="max-w-4xl mx-auto space-y-5 w-full min-w-0">
            <div className="text-center space-y-2 px-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#151D14] border border-[#2B3929] text-[11px] font-semibold text-[#A3C686]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto Watermark Remover &amp; HD Enhancer</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[#F5F9F3] font-display leading-tight">
                Clean Gemini Watermarks &amp; Enhance to HD
              </h1>
              <p className="text-xs sm:text-sm text-[#9AA895] max-w-xl mx-auto leading-relaxed">
                Upload any photo or video — watermark removal, clean HD enhancement, and original stereo audio preservation run automatically.
              </p>
            </div>

            <WatermarkStudio onAddHistory={handleAddHistory} />
          </div>
        </section>

        {/* =========================================================
            2. HISTORY SECTION — RESPONSIVE MOBILE CARDS & DESKTOP TABLE
            ========================================================= */}
        <section id="history" className="py-10 sm:py-12 px-3.5 sm:px-6 border-b border-[#1A2218] bg-[#0B0F0B]">
          <div className="max-w-4xl mx-auto space-y-5 w-full min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-bold text-[#F3F7F1] font-display tracking-tight">
                  Processing History
                </h2>
                <p className="text-xs text-[#9AA895]">
                  Compare Before/After or download your Original &amp; Watermark-Free HD files.
                </p>
              </div>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="px-3 py-2 rounded-xl bg-[#141B13] border border-[#2D3B2B] hover:border-[#496142] text-xs font-semibold text-[#A9B8A4] hover:text-white flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear ({history.length})</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="bg-[#121811] border border-[#263224] rounded-3xl py-10 px-5 text-center text-xs sm:text-sm text-[#9AA895]">
                No processed files yet. Upload a photo or video above to see your cleaned HD media here.
              </div>
            ) : (
              <>
                {/* Mobile Responsive Cards (Zero Horizontal Scroll on Phones!) */}
                <div className="grid grid-cols-1 gap-3 md:hidden">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="bg-[#121811] border border-[#263224] rounded-2xl p-3.5 space-y-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => setPreviewHistoryItem(item)}
                          className="relative w-16 h-12 rounded-xl overflow-hidden bg-[#090C09] border border-[#2C3A29] flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          <img
                            src={item.cleanedPreviewUrl}
                            alt={item.fileName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <Play className="w-4 h-4 text-white" />
                          </div>
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-xs sm:text-sm text-[#F1F5F0] truncate">
                            {item.fileName}
                          </div>
                          <div className="text-[11px] text-[#9AA895] font-mono tabular-nums truncate">
                            {item.kind.toUpperCase()} · {item.originalWidth}×{item.originalHeight}px ·{' '}
                            {formatBytes(item.outputSizeBytes)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewHistoryItem(item)}
                          className="py-2 px-2.5 rounded-xl bg-[#1A2318] hover:bg-[#232F20] border border-[#32422F] text-[#D7E8C8] font-bold text-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 text-[#A3C686] shrink-0" />
                          <span>Compare</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            triggerReliableDownload(
                              item.originalFileUrl,
                              item.originalDownloadUrl,
                              item.originalFileName || item.fileName
                            )
                          }
                          className="py-2 px-2.5 rounded-xl bg-[#182016] hover:bg-[#222D1F] border border-[#2E3C2B] text-[#D5E3CE] font-semibold text-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span>Original</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            triggerReliableDownload(
                              item.outputUrl,
                              item.outputDownloadUrl,
                              item.fileName
                            )
                          }
                          className="py-2 px-2.5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span>Clean HD</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block bg-[#121811] border border-[#263224] rounded-3xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#222D20] text-xs text-[#9AA895]">
                        <th className="py-3.5 px-4 font-semibold">Preview</th>
                        <th className="py-3.5 px-4 font-semibold">File</th>
                        <th className="py-3.5 px-4 font-semibold text-right">Resolution</th>
                        <th className="py-3.5 px-4 font-semibold text-right">Size</th>
                        <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1C251A] text-sm">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-[#182016]/60 transition-colors">
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => setPreviewHistoryItem(item)}
                              className="relative w-16 h-10 rounded-lg overflow-hidden bg-[#0E130D] border border-[#2C3A29] flex items-center justify-center cursor-pointer"
                              title="Click to Compare Before & After"
                            >
                              <img
                                src={item.cleanedPreviewUrl}
                                alt={item.fileName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <Play className="w-4 h-4 text-white" />
                              </div>
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[#EBF2E8] truncate max-w-[200px]">
                              {item.fileName}
                            </div>
                            <div className="text-xs text-[#9AA895] font-mono tabular-nums">
                              {item.kind.toUpperCase()}
                              {item.durationSec ? ` · ${item.durationSec}s` : ''} · {item.processedAt}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-[#E2EDE0]">
                            {item.originalWidth}×{item.originalHeight}px
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-[#C6D4C0]">
                            {formatBytes(item.outputSizeBytes)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPreviewHistoryItem(item)}
                                className="px-3 py-1.5 rounded-xl bg-[#1A2318] hover:bg-[#243021] border border-[#32422F] text-[#D7E8C8] font-semibold text-xs inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                <span>Compare</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  triggerReliableDownload(
                                    item.originalFileUrl,
                                    item.originalDownloadUrl,
                                    item.originalFileName || item.fileName
                                  )
                                }
                                className="px-3 py-1.5 rounded-xl bg-[#182016] hover:bg-[#222D1F] border border-[#32422F] text-[#D5E3CE] font-semibold text-xs inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                <span>Download Original</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  triggerReliableDownload(
                                    item.outputUrl,
                                    item.outputDownloadUrl,
                                    item.fileName
                                  )
                                }
                                className="px-3.5 py-1.5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download Watermark-Free</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        {/* =========================================================
            3. CONTACT SECTION — ONLY SUPPORT LOGO + t.me/loserxash
            ========================================================= */}
        <section id="contact" className="py-10 sm:py-12 px-3.5 sm:px-6">
          <div className="max-w-xl mx-auto w-full min-w-0">
            <div className="bg-[#121811] border border-[#263224] rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-xl">
              {/* Support Logo Badge */}
              <div className="w-15 h-15 mx-auto rounded-2xl bg-[#84A96A]/15 border border-[#84A96A]/70 flex items-center justify-center">
                <Headset className="w-7 h-7 text-[#A3C686]" />
              </div>

              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold text-[#F3F7F1] font-display tracking-tight">
                  Contact &amp; Support
                </h2>
                <p className="text-xs sm:text-sm text-[#9AA895]">
                  Direct official support on Telegram
                </p>
              </div>

              {/* Support Link Button: t.me/loserxash */}
              <div className="pt-1">
                <a
                  href={TELEGRAM_SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-sm transition-colors shadow-md"
                >
                  <Headset className="w-4 h-4 shrink-0" />
                  <span className="font-mono">t.me/loserxash</span>
                  <ExternalLink className="w-4 h-4 shrink-0" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* History Item Preview / Play Modal */}
      {previewHistoryItem && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setPreviewHistoryItem(null)}
        >
          <div
            className="bg-[#121811] border border-[#344631] rounded-3xl max-w-xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-auto overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#222D20] pb-3">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-[#F3F7F1] truncate font-display">
                  {previewHistoryItem.fileName}
                </h3>
                <p className="text-xs text-[#9AA895] font-mono">
                  {previewHistoryItem.originalWidth}×{previewHistoryItem.originalHeight}px ·{' '}
                  {formatBytes(previewHistoryItem.outputSizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewHistoryItem(null)}
                className="p-1.5 rounded-xl bg-[#1A2218] border border-[#2C3A29] text-[#A9B8A4] hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <BeforeAfterMediaSlider
              kind={previewHistoryItem.kind}
              beforeUrl={previewHistoryItem.originalFileUrl}
              afterUrl={previewHistoryItem.outputUrl}
              fallbackBeforeUrl={previewHistoryItem.originalDownloadUrl}
              fallbackAfterUrl={previewHistoryItem.outputDownloadUrl}
              altText={previewHistoryItem.fileName}
              maxHeightClass="max-h-[300px]"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    previewHistoryItem.originalFileUrl,
                    previewHistoryItem.originalDownloadUrl,
                    previewHistoryItem.originalFileName || previewHistoryItem.fileName
                  )
                }
                className="py-3 px-4 rounded-xl bg-[#1A2218] hover:bg-[#232F20] border border-[#344631] text-[#E6F0E0] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#A3C686] shrink-0" />
                <span>Download Original</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    previewHistoryItem.outputUrl,
                    previewHistoryItem.outputDownloadUrl,
                    previewHistoryItem.fileName
                  )
                }
                className="py-3 px-4 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Download Watermark-Free</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-[#1A2218] bg-[#070A07] py-5 px-4 sm:px-6 text-xs text-[#889982] w-full">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span className="font-bold text-[#E6F0E0] font-display">MediaGuard</span>
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            <a href="#home" className="hover:text-white">Home</a>
            <a href="#history" className="hover:text-white">History</a>
            <a href="#contact" className="hover:text-white">Contact</a>
            <a
              href={TELEGRAM_SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#A3C686] hover:underline font-mono"
            >
              t.me/loserxash
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
