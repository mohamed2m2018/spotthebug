"use client";

import styles from "./BugAvatar.module.css";

interface BugAvatarProps {
  isSpeaking: boolean;
  isListening: boolean;
  isConnected: boolean;
}

/**
 * Animated bug mascot that reacts to AI voice state:
 * - Speaking: mouth opens, body glows
 * - Listening: antenna pulse, subtle lean  
 * - Idle: gentle breathing, random blinks
 */
export default function BugAvatar({ isSpeaking, isListening, isConnected }: BugAvatarProps) {
  const stateClass = isSpeaking 
    ? styles.speaking 
    : isListening 
      ? styles.listening 
      : styles.idle;

  return (
    <div className={`${styles.avatarContainer} ${stateClass}`}>
      {/* Glow ring */}
      <div className={`${styles.glowRing} ${isSpeaking ? styles.glowActive : ""}`} />
      
      <svg viewBox="0 0 120 120" className={styles.bugSvg}>
        {/* Antennae */}
        <g className={styles.antennae}>
          <line x1="45" y1="30" x2="30" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="30" cy="8" r="4" fill="currentColor" className={styles.antennaeTip} />
          <line x1="75" y1="30" x2="90" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="90" cy="8" r="4" fill="currentColor" className={styles.antennaeTip} />
        </g>

        {/* Body */}
        <ellipse cx="60" cy="70" rx="35" ry="38" className={styles.body} />
        
        {/* Body stripes */}
        <ellipse cx="60" cy="58" rx="28" ry="4" className={styles.stripe} />
        <ellipse cx="60" cy="72" rx="30" ry="4" className={styles.stripe} />
        <ellipse cx="60" cy="86" rx="26" ry="4" className={styles.stripe} />

        {/* Head */}
        <circle cx="60" cy="42" r="22" className={styles.head} />

        {/* Eyes */}
        <g className={styles.eyes}>
          <ellipse cx="50" cy="40" rx="6" ry="7" className={styles.eyeWhite} />
          <ellipse cx="51" cy="41" rx="3" ry="3.5" className={styles.eyePupil} />
          <ellipse cx="70" cy="40" rx="6" ry="7" className={styles.eyeWhite} />
          <ellipse cx="71" cy="41" rx="3" ry="3.5" className={styles.eyePupil} />
        </g>

        {/* Blink overlay */}
        <g className={styles.blink}>
          <ellipse cx="50" cy="40" rx="6.5" ry="7.5" />
          <ellipse cx="70" cy="40" rx="6.5" ry="7.5" />
        </g>

        {/* Mouth */}
        <g className={styles.mouth}>
          {isSpeaking ? (
            <ellipse cx="60" cy="52" rx="6" ry="5" className={styles.mouthOpen} />
          ) : (
            <path d="M54 50 Q60 55 66 50" className={styles.mouthClosed} />
          )}
        </g>

        {/* Little legs */}
        <g className={styles.legs}>
          <line x1="32" y1="60" x2="18" y2="55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="32" y1="75" x2="16" y2="78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="88" y1="60" x2="102" y2="55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="88" y1="75" x2="104" y2="78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>

      {/* Status label */}
      <span className={styles.statusLabel}>
        {!isConnected ? "Offline" : isSpeaking ? "Speaking..." : isListening ? "Listening..." : "Ready"}
      </span>
    </div>
  );
}
