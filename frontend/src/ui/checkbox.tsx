"use client";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}

function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = "",
  labelClassName = "",
}: CheckboxProps) {
  return (
    <label
      className={`flex items-start gap-2 cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-(--ui-border) bg-(--ui-bg)"
      />
      {(label || description) && (
        <div>
          {label && (
            <span className={`text-sm font-medium text-(--ui-muted) ${labelClassName}`}>
              {label}
            </span>
          )}
          {description && <p className="mt-1 text-xs text-(--ui-muted)">{description}</p>}
        </div>
      )}
    </label>
  );
}

export { Checkbox };
export type { CheckboxProps };
