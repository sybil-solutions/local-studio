// CRITICAL
"use client";

import {
  useRef,
  useEffect,
  useState,
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

interface DropdownContextType {
  close: () => void;
}

const DropdownContext = createContext<DropdownContextType | null>(null);

interface ToolDropdownProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  buttonVariant?: "default" | "circle";
  buttonClassName?: string;
  children: ReactNode;
}

export function ToolDropdown({
  icon: Icon,
  label,
  isActive,
  disabled,
  showChevron = true,
  buttonVariant = "default",
  buttonClassName,
  children,
}: ToolDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;

      // Don't close if clicking on a select element or its options
      // (native select dropdowns render outside the container)
      if (
        target instanceof HTMLElement &&
        (target.tagName === "SELECT" ||
          target.tagName === "OPTION" ||
          target.closest("select") !== null)
      ) {
        return;
      }

      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <DropdownContext.Provider value={{ close }}>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
          className={
            buttonVariant === "circle"
              ? [
                  "h-10 w-10 rounded-full border border-(--border) flex items-center justify-center",
                  "bg-(--surface) text-(--dim)",
                  "hover:bg-(--accent) hover:text-(--fg) transition-colors disabled:opacity-50",
                  isActive ? "ring-1 ring-(--hl1)/35 text-(--fg)" : "",
                  buttonClassName ?? "",
                ].join(" ")
              : [
                  "flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all:ease-in:200ms disabled:opacity-50",
                  isActive
                    ? "bg-(--bg) text-(--hl1) border border-(--border)"
                    : "hover:bg-(--accent) text-(--dim)",
                  buttonClassName ?? "",
                ].join(" ")
          }
          title={label}
        >
          <Icon className={buttonVariant === "circle" ? "h-4 w-4" : "h-3.5 w-3.5"} />
          {showChevron && buttonVariant !== "circle" && (
            <ChevronDown
              className={`h-2.5 w-2.5 transition-transform:ease-in:150ms ${open ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {open && (
          <div className="absolute bottom-full left-0 mb-1 min-w-[170px] bg-(--bg) border border-(--border) rounded-lg shadow-xl transition-all:ease-in:200ms py-1 z-50">
            {children}
          </div>
        )}
      </div>
    </DropdownContext.Provider>
  );
}

interface DropdownItemProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  closeOnClick?: boolean;
}

export function DropdownItem({
  icon: Icon,
  label,
  isActive,
  onClick,
  disabled,
  closeOnClick = false,
}: DropdownItemProps) {
  const context = useContext(DropdownContext);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick?.();
    if (closeOnClick) {
      context?.close();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 font-sans font-medium text-xs transition-colors:ease-in:200ms disabled:opacity-50 ${
        isActive
          ? "bg-(--bg) text-(--hl1) border-l-2 border-(--hl1)"
          : "hover:bg-(--bg) focus:bg-(--bg) text-(--dim) hover:text-(--fg)"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-xs">{label}</span>
      {isActive && <span className="ml-auto w-2.5 h-2.5 rounded-full bg-(--hl1)" />}
    </button>
  );
}
