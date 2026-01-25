interface QuickLaunchSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function QuickLaunchSearch({ value, onChange }: QuickLaunchSearchProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search recipes..."
      className="w-full px-3 py-2 bg-transparent border border-(--border)/20 rounded-lg text-sm text-(--foreground) placeholder:text-(--muted-foreground)/30 focus:outline-none focus:border-(--border)/40 transition-all duration-200 mb-2"
    />
  );
}
