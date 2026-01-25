import { ChevronDown, ChevronUp } from "lucide-react";

interface QuickLaunchHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  onNewRecipe: () => void;
}

export function QuickLaunchHeader({ expanded, onToggle, onNewRecipe }: QuickLaunchHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 font-medium hover:text-(--foreground)/70 transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        Quick Launch
      </button>
      <button
        onClick={onNewRecipe}
        className="text-[10px] text-(--muted-foreground)/40 hover:text-(--foreground)/60 transition-colors"
      >
        new
      </button>
    </div>
  );
}
