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
    // Sync history cleanup on mount
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
    <div className="min-h-screen bg-[#0B0E0B] text-[#F1F5F0] flex flex-col">
      {/* =========================================================
          FIRST-TIME JOIN CHANNEL POPUP (https://t.me/+TAbMK2L7iMBkMDQ1)
          ========================================================= */}
      {showChannelPopup && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={handleCloseChannelPopup}
        >
          <div
            className="relative bg-[#151B14] border border-[#384B34] rounded-[28px] max-w-md w-full p-6 space-y-5 shadow-2xl text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cut / Close Button */}
            <button
              type="button"
              onClick={handleCloseChannelPopup}
              aria-label="Close popup"
              className="absolute top-4 right-4 p-2 rounded-xl bg-[#1E271C] hover:bg-[#283425] border border-[#32422F] text-[#A9B8A4] hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Channel Icon */}
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center">
              <Send className="w-8 h-8 text-[#A3C686]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-[#F3F7F1]">
                Join Our Official Telegram Channel
              </h2>
              <p className="text-xs sm:text-sm text-[#9AA895]">
                Get latest updates, tools, and direct announcements on our official Telegram channel.
              </p>
            </div>

            <div className="space-y-2.5 pt-1">
              <a
                href={TELEGRAM_CHANNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCloseChannelPopup}
                className="w-full py-3 px-5 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Join Telegram Channel</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={handleCloseChannelPopup}
                className="w-full py-2.5 px-4 rounded-xl bg-[#1B2319] hover:bg-[#243021] border border-[#2C3A29] text-xs font-semibold text-[#A9B8A4] hover:text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header: MediaGuard + ONLY 3 Sections (Home, History, Contact) */}
      <header className="sticky top-0 z-40 bg-[#0B0E0B]/95 backdrop-blur-md border-b border-[#222B20]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 py-3.5">
          <a
            href="#home"
            className="text-xl font-bold tracking-tight text-[#F3F7F1] whitespace-nowrap shrink-0 font-display"
          >
            MediaGuard
          </a>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#A9B8A4]">
            <a
              href="#home"
              className="hover:text-[#F3F7F1] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Home
            </a>
            <a
              href="#history"
              className="hover:text-[#F3F7F1] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              History ({history.length})
            </a>
            <a
              href="#contact"
              className="hover:text-[#F3F7F1] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href="#home"
              className="px-4 py-2 text-xs font-semibold text-[#0B0F0A] bg-[#84A96A] hover:bg-[#95B97B] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Clean Media
            </a>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg border border-[#2A3528] text-[#D5E3CE] hover:text-white cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#222B20] bg-[#111610] px-6 py-4 space-y-2">
            <button
              type="button"
              onClick={() => scrollToSection('home')}
              className="block w-full text-left py-2 text-sm font-medium text-[#C6D4C0] hover:text-white"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('history')}
              className="block w-full text-left py-2 text-sm font-medium text-[#C6D4C0] hover:text-white"
            >
              History ({history.length})
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contact')}
              className="block w-full text-left py-2 text-sm font-medium text-[#C6D4C0] hover:text-white"
            >
              Contact
            </button>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* =========================================================
            1. HOME SECTION — AUTOMATIC WATERMARK REMOVER
            ========================================================= */}
        <section id="home" className="py-10 px-4 sm:px-6 border-b border-[#1E261C]">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#F5F9F3]">
                Automatic Gemini Photo &amp; Video Watermark Remover
              </h1>
              <p className="text-sm text-[#9AA895]">
                Upload your photo or video — watermark removal and original quality output happen automatically.
              </p>
            </div>

            <WatermarkStudio onAddHistory={handleAddHistory} />
          </div>
        </section>

        {/* =========================================================
            2. HISTORY SECTION — PROCESSED PHOTOS & VIDEOS
            ========================================================= */}
        <section id="history" className="py-12 px-4 sm:px-6 border-b border-[#1E261C] bg-[#0E130D]">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-[#F3F7F1]">
                  Processing History
                </h2>
                <p className="text-xs text-[#9AA895]">
                  Preview or download your Original and Watermark-Free files in 100% original quality.
                </p>
              </div>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="px-3 py-1.5 rounded-lg border border-[#32412F] hover:border-[#52684D] text-xs font-medium text-[#A9B8A4] hover:text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear ({history.length})</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="bg-[#151B14] border border-[#2A3528] rounded-2xl py-10 px-6 text-center text-sm text-[#9AA895]">
                No processed files yet. Upload a photo or video in the Home section above to see it here.
              </div>
            ) : (
              <div className="bg-[#151B14] border border-[#2A3528] rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#253023] text-xs text-[#9AA895]">
                        <th className="py-3 px-4 font-medium">Preview</th>
                        <th className="py-3 px-4 font-medium">File</th>
                        <th className="py-3 px-4 font-medium text-right">Resolution</th>
                        <th className="py-3 px-4 font-medium text-right">Size</th>
                        <th className="py-3 px-4 font-medium text-right">Actions (Original Quality)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#20291E] text-sm">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-[#1B2319]/60 transition-colors">
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => setPreviewHistoryItem(item)}
                              className="relative w-16 h-10 rounded-lg overflow-hidden bg-[#0E130D] border border-[#2C3A29] flex items-center justify-center group cursor-pointer"
                              title="Click to Play / Preview"
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
                            <div className="font-medium text-[#EBF2E8] truncate max-w-[180px]">
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
                                className="px-2.5 py-1.5 rounded-lg bg-[#1A2318] hover:bg-[#243021] border border-[#32422F] text-[#D7E8C8] font-semibold text-xs inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                <span>Play</span>
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
                                className="px-3 py-1.5 rounded-lg bg-[#1E271C] hover:bg-[#283425] border border-[#32422F] text-[#D5E3CE] font-semibold text-xs inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
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
                                className="px-3.5 py-1.5 rounded-lg bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
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
              </div>
            )}
          </div>
        </section>

        {/* =========================================================
            3. CONTACT SECTION — ONLY SUPPORT LOGO + t.me/loserxash
            ========================================================= */}
        <section id="contact" className="py-12 px-4 sm:px-6">
          <div className="max-w-xl mx-auto">
            <div className="bg-[#151B14] border border-[#2A3528] rounded-[28px] p-6 sm:p-8 text-center space-y-5">
              {/* Support Logo Badge */}
              <div className="w-16 h-16 mx-auto rounded-2xl bg-[#84A96A]/20 border border-[#84A96A] flex items-center justify-center">
                <Headset className="w-8 h-8 text-[#A3C686]" />
              </div>

              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-bold text-[#F3F7F1]">
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
                  className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-sm transition-colors"
                >
                  <Headset className="w-5 h-5" />
                  <span className="font-mono">t.me/loserxash</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* History Item Preview / Play Modal */}
      {previewHistoryItem && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewHistoryItem(null)}
        >
          <div
            className="bg-[#151B14] border border-[#384B34] rounded-[28px] max-w-xl w-full p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#253023] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#F3F7F1] truncate max-w-[260px]">
                  {previewHistoryItem.fileName}
                </h3>
                <p className="text-xs text-[#9AA895]">
                  {previewHistoryItem.originalWidth}×{previewHistoryItem.originalHeight}px ·{' '}
                  {formatBytes(previewHistoryItem.outputSizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewHistoryItem(null)}
                className="p-1.5 rounded-lg border border-[#2C3A29] text-[#A9B8A4] hover:text-white cursor-pointer"
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
              maxHeightClass="max-h-[330px]"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  triggerReliableDownload(
                    previewHistoryItem.originalFileUrl,
                    previewHistoryItem.originalDownloadUrl,
                    previewHistoryItem.originalFileName || previewHistoryItem.fileName
                  )
                }
                className="py-2.5 px-4 rounded-xl bg-[#1E271C] hover:bg-[#283425] border border-[#384B34] text-[#E6F0E0] font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#A3C686]" />
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
                className="py-2.5 px-4 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Watermark-Free</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-[#1E261C] bg-[#090C09] py-5 px-4 sm:px-6 text-xs text-[#889982]">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <span className="font-bold text-[#E6F0E0]">MediaGuard</span>
          <div className="flex items-center gap-5">
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
