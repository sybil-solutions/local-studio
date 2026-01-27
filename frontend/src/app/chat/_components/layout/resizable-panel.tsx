// CRITICAL
"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { X } from "lucide-react";

interface ResizablePanelProps {
  children: ReactNode;
  sidePanel: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  isOpen: boolean;
  onToggle: () => void;
}

export function ResizablePanel({
  children,
  sidePanel,
  defaultWidth = 420,
  minWidth = 320,
  maxWidth = 800,
  isOpen,
  onToggle,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const delta = startXRef.current - e.clientX;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
    setWidth(newWidth);
  }, [isResizing, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>

      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="hidden md:flex items-center justify-center w-8 h-8 mt-4 mr-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-[#888] hover:text-foreground transition-colors"
          title="Open preview panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      {/* Resizable side panel */}
      {isOpen && (
        <div
          className="hidden md:flex flex-shrink-0 flex-col h-full border-l border-white/[0.06] bg-[#0a0a0a]/95 backdrop-blur-xl"
          style={{ width: `${width}px` }}
        >
          {/* Header with close */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-xs font-medium text-[#888]">Preview</span>
            <button
              onClick={onToggle}
              className="p-1.5 rounded hover:bg-white/[0.06] text-[#666] hover:text-[#888] transition-colors"
              title="Close panel"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {sidePanel}
          </div>

          {/* Resize handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/10 transition-colors"
            onMouseDown={handleMouseDown}
            style={{
              position: "absolute" as const,
              left: 0,
              top: 0,
              bottom: 0,
              width: "4px",
            }}
          />
        </div>
      )}
    </div>
  );
}
