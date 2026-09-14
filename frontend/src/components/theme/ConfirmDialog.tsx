"use client";

import { useState } from "react";
import { WoodButton } from "./Panel";

// Replaces window.prompt()/window.confirm() for every admin override
// action (reset password, remove staff, delete team, force stage,
// reset event, ...) - the native browser dialog those used to call is
// unreadable (tiny system font, low contrast, no theming at all) and,
// worse, REQUIRED typing something into it before the action would go
// through, since the code checked "did the user type a non-empty
// string" to decide whether to proceed at all. Reasons are now optional
// everywhere (the server records a placeholder if left blank - see
// audit.ts's recordAudit) - this dialog reflects that: the Confirm
// button is enabled immediately, filling in the reason is invited, not
// demanded.
export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (reason: string) => void;
}

export function ConfirmDialog({ state, onClose }: { state: ConfirmDialogState | null; onClose: () => void }) {
  const [reason, setReason] = useState("");

  if (!state) return null;

  function handleConfirm() {
    if (!state) return;
    state.onConfirm(reason);
    setReason("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#2b2016] border-2 border-[#764A21] rounded-lg shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-[#FDE047] mb-2">{state.title}</h2>
        <p className="text-white text-sm mb-4 leading-relaxed">{state.message}</p>
        <label className="block text-white/80 text-sm mb-1">Reason (optional)</label>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Why are you doing this? (not required)"
          className="w-full px-3 py-2 rounded text-black mb-4"
        />
        <div className="flex justify-end gap-2">
          <WoodButton onClick={onClose}>Cancel</WoodButton>
          <WoodButton variant={state.danger ? "danger" : "primary"} onClick={handleConfirm}>
            {state.confirmLabel ?? "Confirm"}
          </WoodButton>
        </div>
      </div>
    </div>
  );
}
