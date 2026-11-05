import React, { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { UserRequirementsConfig } from '../types/media';

interface RequirementsPromptPanelProps {
  config: UserRequirementsConfig;
  onSaveConfig: (updated: UserRequirementsConfig) => void;
  onResetConfig: () => void;
}

export const RequirementsPromptPanel: React.FC<RequirementsPromptPanelProps> = ({
  config,
  onSaveConfig,
  onResetConfig,
}) => {
  const [draft, setDraft] = useState<UserRequirementsConfig>(config);
  const [savedBanner, setSavedBanner] = useState<boolean>(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      ...draft,
      isConfigured: Boolean(
        draft.ownerName.trim() ||
          draft.contactEmail.trim() ||
          draft.contactPhone.trim() ||
          draft.locationText.trim()
      ),
    });
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  return (
    <div className="bg-[#151B14] border border-[#2A3528] rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-[#253023] pb-4">
        <div>
          <h3 className="text-base font-bold text-[#F1F5F0]">
            Set Your Contact Details
          </h3>
          <p className="text-xs text-[#9AA895]">
            Enter your own name, email, phone, and location below.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            onResetConfig();
            setDraft({
              ...draft,
              isConfigured: false,
              ownerName: '',
              contactEmail: '',
              contactPhone: '',
              whatsappNumber: '',
              locationText: '',
            });
          }}
          className="px-3 py-1.5 rounded-lg border border-[#303E2D] text-xs text-[#B8C7B4] hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#C6D4C0] mb-1">
              Your Name
            </label>
            <input
              type="text"
              value={draft.ownerName}
              onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })}
              placeholder="Enter your name"
              className="w-full bg-[#0E130D] border border-[#2C3A29] rounded-xl px-3.5 py-2 text-sm text-[#F1F5F0] placeholder-[#5F705B] focus:outline-none focus:border-[#84A96A]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C6D4C0] mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={draft.contactEmail}
              onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
              placeholder="Enter your email"
              className="w-full bg-[#0E130D] border border-[#2C3A29] rounded-xl px-3.5 py-2 text-sm text-[#F1F5F0] placeholder-[#5F705B] focus:outline-none focus:border-[#84A96A]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C6D4C0] mb-1">
              Phone / WhatsApp Number
            </label>
            <input
              type="tel"
              value={draft.contactPhone}
              onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })}
              placeholder="Enter your phone number"
              className="w-full bg-[#0E130D] border border-[#2C3A29] rounded-xl px-3.5 py-2 text-sm text-[#F1F5F0] placeholder-[#5F705B] focus:outline-none focus:border-[#84A96A]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#C6D4C0] mb-1">
              City / Location
            </label>
            <input
              type="text"
              value={draft.locationText}
              onChange={(e) => setDraft({ ...draft, locationText: e.target.value })}
              placeholder="Enter your city"
              className="w-full bg-[#0E130D] border border-[#2C3A29] rounded-xl px-3.5 py-2 text-sm text-[#F1F5F0] placeholder-[#5F705B] focus:outline-none focus:border-[#84A96A]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <div className="text-xs text-[#9AA895]">
            {savedBanner && (
              <span className="text-[#A3C686] font-medium inline-flex items-center gap-1">
                <Check className="w-4 h-4" />
                Saved!
              </span>
            )}
          </div>

          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-[#84A96A] hover:bg-[#95B97B] text-[#0B0F0A] font-semibold text-xs cursor-pointer"
          >
            Save Contact Details
          </button>
        </div>
      </form>
    </div>
  );
};
