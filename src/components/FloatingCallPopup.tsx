"use client";

import { useRef, useCallback, useState } from "react";
import BugAvatar from "@/components/BugAvatar";
import styles from "./FloatingCallPopup.module.css";

// ── Types ──

interface FloatingCallPopupProps {
  isConnected: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  elapsedTime: number;
  onToggleMic: () => void;
  onEnd: () => void;
  onClose: () => void;
  /** Opens a native desktop-level PiP window (Chrome/Edge only) */
  onPinToDesktop?: () => void;
}

// ── Helpers ──

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** Clamp position so the popup stays within the viewport */
const clampPosition = (x: number, y: number, width: number, height: number) => ({
  x: Math.max(0, Math.min(x, window.innerWidth - width)),
  y: Math.max(0, Math.min(y, window.innerHeight - height)),
});

// ── Component ──

export default function FloatingCallPopup({
  isConnected,
  isRecording,
  isSpeaking,
  elapsedTime,
  onToggleMic,
  onEnd,
  onClose,
  onPinToDesktop,
}: FloatingCallPopupProps) {
  const supportsPiP = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const POPUP_WIDTH = 300;
  const POPUP_HEIGHT = 220;
  const EDGE_OFFSET = 24;

  // Position state — bottom-right by default
  const [pos, setPos] = useState({
    x: typeof window !== "undefined" ? window.innerWidth - POPUP_WIDTH - EDGE_OFFSET : 0,
    y: typeof window !== "undefined" ? window.innerHeight - POPUP_HEIGHT - EDGE_OFFSET : 0,
  });

  // Drag state refs (not reactive — no re-renders during drag)
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  // ── Drag handlers ──

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the header
    if (!(e.target as HTMLElement).closest("[data-drag-handle]")) return;

    dragging.current = true;
    dragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };

    // Capture pointer for smooth drag beyond element bounds
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;

    const newX = e.clientX - dragOffset.current.x;
    const newY = e.clientY - dragOffset.current.y;

    const clamped = clampPosition(newX, newY, POPUP_WIDTH, POPUP_HEIGHT);
    setPos(clamped);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Header — drag handle */}
      <div className={styles.header} data-drag-handle>
        <div className={styles.headerLeft}>
          <span>🐛</span>
          <span className={styles.headerTitle}>SpotTheBug</span>
        </div>
        <div className={styles.headerActions}>
          {supportsPiP && onPinToDesktop && (
            <button
              className={styles.headerBtn}
              onClick={onPinToDesktop}
              title="Pin to desktop — stays on top of all apps"
            >
              📌
            </button>
          )}
          <button
            className={`${styles.headerBtn} ${styles.closeBtn}`}
            onClick={onClose}
            title="Hide popup"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Mini avatar */}
        <div className={styles.avatarWrap}>
          <BugAvatar
            isSpeaking={isSpeaking}
            isListening={isRecording && !isSpeaking}
            isConnected={isConnected}
          />
        </div>

        {/* Status row */}
        <div className={styles.statusRow}>
          <div className={styles.connectionBadge}>
            <span className={`${styles.dot} ${isConnected ? styles.dotConnected : ""}`} />
            {isConnected ? "Connected" : "Disconnected"}
          </div>
          <span className={styles.timer}>{formatTime(elapsedTime)}</span>
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          <button
            className={`${styles.micBtn} ${isRecording ? styles.micBtnActive : styles.micBtnInactive}`}
            onClick={onToggleMic}
          >
            {isRecording ? "⏹ Mute" : "🎤 Unmute"}
          </button>
          <button className={styles.endBtn} onClick={onEnd}>
            ⏹ End
          </button>
        </div>
      </div>
    </div>
  );
}
