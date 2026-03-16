"use client";

import { useCallback, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

/**
 * Map bug language strings to Monaco language IDs.
 * Keeps the mapping in one place — both HuntSession and SolveSession use this.
 */
const LANGUAGE_MAP: Record<string, string> = {
  tsx: "typescript",
  typescript: "typescript",
  ts: "typescript",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  python: "python",
  py: "python",
  html: "html",
  css: "css",
  json: "json",
};

interface CodeEditorProps {
  /** Code content */
  value: string;
  /** Called on code change (debounce externally if needed) */
  onChange?: (value: string) => void;
  /** Language for syntax highlighting (maps bug.language to Monaco ID) */
  language?: string;
  /** Prevent editing (for problem descriptions, read-only display) */
  readOnly?: boolean;
  /** Minimum height in pixels */
  minHeight?: number;
}

export default function CodeEditor({
  value,
  onChange,
  language = "javascript",
  readOnly = false,
  minHeight,
}: CodeEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // Focus editor on mount for immediate typing
    if (!readOnly) editor.focus();
  }, [readOnly]);

  const handleChange = useCallback(
    (val: string | undefined) => {
      if (onChange && val !== undefined) onChange(val);
    },
    [onChange]
  );

  const monacoLanguage = LANGUAGE_MAP[language.toLowerCase()] || language;

  return (
    <Editor
      height={minHeight ? `${minHeight}px` : "100%"}
      language={monacoLanguage}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        readOnly,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        lineHeight: 24,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: "gutter",
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: "always",
        tabSize: 2,
        wordWrap: "on",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        // Hide unnecessary UI for a training app
        folding: false,
        glyphMargin: false,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        contextmenu: false,
      }}
    />
  );
}
