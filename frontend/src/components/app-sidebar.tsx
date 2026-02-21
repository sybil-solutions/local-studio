// CRITICAL
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useAppStore } from "@/store";
import { ChatSessionsSection } from "./app-sidebar/chat-sessions-section";
import { MobileHeaderStatus } from "./app-sidebar/mobile-header-status";
import { navItems } from "./app-sidebar/nav-items";
import { SidebarStatus } from "./app-sidebar/sidebar-status";

interface AppSidebarProps {
  children: React.ReactNode;
}

export function AppSidebar({ children }: AppSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(pathname === "/chat");
  const [hydrated, setHydrated] = useState(useAppStore.persist.hasHydrated());
  const loadingSessionsRef = useRef(false);
  const router = useRouter();
  const chatSessions = useAppStore((state) => state.sessions);
  const setSessions = useAppStore((state) => state.setSessions);

  useEffect(() => {
    if (hydrated) return;
    const unsubscribe = useAppStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    void useAppStore.persist.rehydrate();
    return unsubscribe;
  }, [hydrated]);

  // Detect mobile and restore collapsed state after mount
  useEffect(() => {
    const applyLayout = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true);
        return;
      }
      const saved = localStorage.getItem("app-sidebar-collapsed");
      setCollapsed(saved === "true");
    };
    applyLayout();
    window.addEventListener("resize", applyLayout);
    return () => window.removeEventListener("resize", applyLayout);
  }, []);

  // Allow mobile sidebar control from chat page
  useEffect(() => {
    const handleToggle = (event: Event) => {
      const custom = event as CustomEvent<{ open?: boolean }>;
      const requested = custom?.detail?.open;
      if (typeof requested === "boolean") {
        setMobileOpen(requested);
      } else {
        setMobileOpen((current) => !current);
      }
    };
    window.addEventListener("vllm:toggle-sidebar", handleToggle as EventListener);
    return () => {
      window.removeEventListener("vllm:toggle-sidebar", handleToggle as EventListener);
    };
  }, []);

  // Save collapsed state
  const toggleCollapsed = () => {
    const newVal = !collapsed;
    setCollapsed(newVal);
    if (!isMobile) {
      localStorage.setItem("app-sidebar-collapsed", String(newVal));
    }
  };

  useEffect(() => {
    setChatHistoryOpen(pathname === "/chat");
  }, [pathname]);

  // Load chat sessions once after hydration so sidebar search/list is available across pages.
  useEffect(() => {
    if (!hydrated) return;
    if (loadingSessionsRef.current) return;
    loadingSessionsRef.current = true;
    api
      .getChatSessions()
      .then((result) => setSessions(result.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => {
        loadingSessionsRef.current = false;
      });
  }, [hydrated, setSessions]);

  const createNewChat = () => {
    setMobileOpen(false);
    router.push("/chat?new=1");
  };

  if (pathname.startsWith("/setup")) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-full overflow-hidden">
      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          ${isMobile ? "fixed left-0 top-0 bottom-0 z-50" : "relative"}
          ${isMobile && !mobileOpen ? "-translate-x-full" : "translate-x-0"}
          ${collapsed && !isMobile ? "w-16" : "w-56"}
          shrink-0 bg-(--bg)/95 backdrop-blur-xl border-r border-(--border)
          flex flex-col transition-all duration-200 ease-out
        `}
        style={{ paddingTop: "env(safe-area-inset-top, 0)" }}
      >
        {/* Logo */}
        <div
          className={`flex items-center h-14 px-3 border-b border-(--border) ${collapsed && !isMobile ? "justify-center" : "gap-3"}`}
        >
          <Image src="/mocks/logo-1.svg" alt="vLLM" width={28} height={28} className="rounded shrink-0" />
          {(!collapsed || isMobile) && (
            <span className="font-semibold text-sm truncate">vLLM Studio</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    if (isMobile) setMobileOpen(false);
                  }}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-colors
                    ${
                      isActive
                        ? "bg-(--border) text-foreground"
                        : "text-(--dim) hover:text-foreground hover:bg-(--border)"
                    }
                    ${collapsed && !isMobile ? "justify-center" : ""}
                  `}
                  title={collapsed && !isMobile ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                  {(!collapsed || isMobile) && (
                    <span className="text-sm font-medium">{item.label}</span>
                  )}
                </Link>
              </div>
            );
          })}

          {/* Chat sessions section (after nav items) */}
          {(!collapsed || isMobile) && (
            <div className="mt-3 pt-2 border-t border-(--border)/50">
              <ChatSessionsSection
                sessions={chatSessions}
                open={chatHistoryOpen}
                setOpen={setChatHistoryOpen}
                isMobile={isMobile}
                onCloseMobile={() => setMobileOpen(false)}
                onNewChat={createNewChat}
              />
            </div>
          )}
        </nav>

        {/* Status */}
        <div
          className={`px-3 py-3 border-t border-(--border) ${collapsed && !isMobile ? "flex justify-center" : ""}`}
        >
          <SidebarStatus collapsed={collapsed} isMobile={isMobile} />
        </div>

        {/* Collapse toggle - desktop only */}
        {!isMobile && (
          <button
            onClick={toggleCollapsed}
            className="absolute -right-3 top-20 w-6 h-6 bg-(--bg) border border-(--border) rounded-full flex items-center justify-center hover:bg-(--border) hover:border-(--border) transition-colors shadow-lg shadow-black/50"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-(--dim)" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5 text-(--dim)" />
            )}
          </button>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden bg-background">
        {/* Mobile header */}
        {isMobile && pathname !== "/chat" && (
          <div
            className="sticky top-0 z-30 bg-(--surface) border-b border-(--border) px-3 py-2 flex items-center gap-2"
            style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0))" }}
          >
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1 -ml-1 rounded hover:bg-(--accent)"
            >
              <Image src="/mocks/logo-1.svg" alt="vLLM" width={20} height={20} className="rounded" />
            </button>
            <span className="font-medium text-xs">
              {navItems.find((item) => item.href === pathname)?.label || "vLLM Studio"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <MobileHeaderStatus />
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
