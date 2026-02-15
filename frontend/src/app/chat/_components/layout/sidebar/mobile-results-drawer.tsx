// CRITICAL
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, PanelRightClose } from "lucide-react";
import type { SidebarTab } from "./unified-sidebar";

interface MobileResultsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: SidebarTab;
  onSetActiveTab: (tab: SidebarTab) => void;
  hasArtifacts: boolean;
  activityContent: React.ReactNode;
  contextContent: React.ReactNode;
  artifactsContent: React.ReactNode;
  filesContent: React.ReactNode;
}

const MIN_DRAWER_HEIGHT = 220;
const DEFAULT_DRAWER_RATIO = 0.72;
const MAX_DRAWER_RATIO = 0.92;
const FALLBACK_DRAWER_HEIGHT = 420;

const TAB_LABELS: Record<SidebarTab, string> = {
  activity: "Activity",
  context: "Context",
  artifacts: "Preview",
  files: "Files",
};

export const MobileResultsDrawer = memo(function MobileResultsDrawer({
  isOpen,
  onClose,
  activeTab,
  onSetActiveTab,
  hasArtifacts,
  activityContent,
  contextContent,
  artifactsContent,
  filesContent,
}: MobileResultsDrawerProps) {
  const tabs = useMemo(() => {
    const list: Array<{ id: SidebarTab; enabled: boolean }> = [
      { id: "activity", enabled: true },
      { id: "files", enabled: true },
      { id: "artifacts", enabled: hasArtifacts },
      { id: "context", enabled: true },
    ];
    return list;
  }, [hasArtifacts]);

  const handleSelect = useCallback(
    (tab: SidebarTab, enabled: boolean) => {
      if (!enabled) return;
      onSetActiveTab(tab);
    },
    [onSetActiveTab],
  );

  const content = useMemo(() => {
    switch (activeTab) {
      case "activity":
        return activityContent;
      case "files":
        return filesContent;
      case "artifacts":
        return hasArtifacts ? artifactsContent : null;
      case "context":
        return contextContent;
      default:
        return activityContent;
    }
  }, [activeTab, activityContent, artifactsContent, contextContent, filesContent, hasArtifacts]);

  const computeMaxHeight = useCallback(() => {
    if (typeof window === "undefined") return 0;
    return Math.floor(window.innerHeight * MAX_DRAWER_RATIO);
  }, []);

  const computeDefaultHeight = useCallback(() => {
    if (typeof window === "undefined") return FALLBACK_DRAWER_HEIGHT;
    const ratioHeight = Math.floor(window.innerHeight * DEFAULT_DRAWER_RATIO);
    const maxHeight = computeMaxHeight();
    return Math.max(MIN_DRAWER_HEIGHT, Math.min(ratioHeight, maxHeight || ratioHeight));
  }, [computeMaxHeight]);

  const [drawerHeightPx, setDrawerHeightPx] = useState<number>(() => {
    // Initialize with a function to avoid setState in effect
    if (typeof window === "undefined") return FALLBACK_DRAWER_HEIGHT;
    const maxHeight = Math.floor(window.innerHeight * MAX_DRAWER_RATIO);
    const ratioHeight = Math.floor(window.innerHeight * DEFAULT_DRAWER_RATIO);
    const defaultHeight = Math.max(MIN_DRAWER_HEIGHT, Math.min(ratioHeight, maxHeight || ratioHeight));
    return defaultHeight;
  });
  const heightRef = useRef<number>(drawerHeightPx);

  useEffect(() => {
    if (typeof window === "undefined") return;
    heightRef.current = drawerHeightPx;
  }, [drawerHeightPx]);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      const maxHeight = computeMaxHeight();
      setDrawerHeightPx((current) =>
        maxHeight === 0 ? current : Math.min(Math.max(current, MIN_DRAWER_HEIGHT), maxHeight),
      );
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [computeDefaultHeight, computeMaxHeight]);

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      dragRef.current = {
        startY: event.clientY,
        startHeight: heightRef.current || computeDefaultHeight(),
      };
      setIsDragging(true);
    },
    [computeDefaultHeight],
  );

  useEffect(() => {
    if (!isDragging) return;

      const handlePointerMove = (event: PointerEvent) => {
        if (!dragRef.current) return;

        const maxHeight = computeMaxHeight();
        const deltaY = dragRef.current.startY - event.clientY;
        const nextHeight = dragRef.current.startHeight + deltaY;
      const constrainedHeight =
        maxHeight === 0
          ? nextHeight
          : Math.min(Math.max(nextHeight, MIN_DRAWER_HEIGHT), maxHeight);

      if (animationRef.current != null) {
        window.cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = window.requestAnimationFrame(() => {
        heightRef.current = constrainedHeight;
        setDrawerHeightPx(constrainedHeight);
      });
    };

    const handlePointerUp = () => {
      if (animationRef.current != null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      dragRef.current = null;
      setIsDragging(false);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      if (animationRef.current != null) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [computeMaxHeight, isDragging]);

  // Track dragging state in a ref to avoid setState in effect
  const isDraggingRef = useRef(isDragging);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (isOpen || !isDraggingRef.current) return;
    if (animationRef.current != null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    dragRef.current = null;
  }, [isOpen]);

  const drawerHeight = drawerHeightPx <= 0 ? computeDefaultHeight() : drawerHeightPx;

  // Escape to close (handy for dev, external keyboards).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      <div className="md:hidden">
        {/* Backdrop */}
        <div
          className={`fixed inset-0 z-40 bg-black/55 transition-opacity duration-200 ${
            isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={onClose}
        />

        {/* Drawer */}
        <div
          className={`fixed left-0 right-0 bottom-0 z-50 transition-transform duration-250 ease-out ${
            isOpen ? "translate-y-0" : "translate-y-[calc(100%+16px)]"
          }`}
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0)", height: `${drawerHeight}px` }}
        >
          <div className="mx-2 mb-2 h-full rounded-2xl border border-white/10 bg-[#070708]/95 backdrop-blur-xl shadow-[0_-12px_40px_rgba(0,0,0,0.65)] overflow-hidden flex flex-col min-h-0">
            {/* Grab handle + close */}
            <div
              className="px-3 pt-2 pb-2 border-b border-white/10 flex items-center gap-2 cursor-row-resize select-none touch-none"
              onPointerDown={handleDragStart}
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-white/10" />
              <GripVertical className="h-3 w-3 text-white/40 shrink-0" />
              <button
                onClick={onClose}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                className="ml-auto -mr-1 p-2 rounded-lg hover:bg-white/5 text-[#777]"
                title="Close"
              >
                  <PanelRightClose className="h-4 w-4" />
                </button>
            </div>

            {/* Tabs */}
            <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
              {tabs.map((t) => {
                const enabled = t.enabled;
                const isActive = activeTab === t.id && enabled;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelect(t.id, enabled)}
                    disabled={!enabled}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? "bg-violet-500/15 text-violet-200"
                        : enabled
                          ? "text-[#888] hover:text-[#ddd] hover:bg-white/5"
                          : "text-[#444] cursor-not-allowed"
                    }`}
                  >
                    {TAB_LABELS[t.id]}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
          </div>
        </div>
      </div>

      {isDragging && (
        <style jsx global>{`
          body {
            cursor: row-resize !important;
            user-select: none !important;
          }
        `}</style>
      )}
    </>
  );
});
