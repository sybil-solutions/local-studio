/**
 * Solid, single-color icon set for the agent surface.
 *
 * Hand-rolled to keep the visual language consistent (16px viewBox,
 * `currentColor`, no strokes). Sized by the consumer with `className`
 * (e.g. `className="h-3.5 w-3.5"`).
 *
 * We only re-export `Folder` / `FolderOpen` from lucide because the user
 * explicitly asked to keep the open/close folder glyphs.
 */
import type { SVGProps } from "react";
export { Folder, FolderOpen } from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, className, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  // Solid square speech bubble (no rounded corners, no tail clutter).
  return (
    <Svg {...props}>
      <path d="M2 2.5h12v9H6l-3 3v-3H2v-9zm2 2v5h2.5L8 11l1.5-1.5H12v-5H4z" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  // Solid push-pin glyph.
  return (
    <Svg {...props}>
      <path d="M9.5 1.2 14.8 6.5l-2.4.6-2.5 2.5.4 2.5-1 1-3-3L2.5 14l-.4-.4 4.8-4.8-3-3 1-1 2.5.4 2.5-2.5.6-2.4z" />
    </Svg>
  );
}

export function PinSlashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 1.4 14.6 14 13.4 15.2.8 2.6 2 1.4zm7.5-.2 5.3 5.3-2.4.6-2.5 2.5.4 2.5-1 1-3-3L2.5 14l-.4-.4 4.8-4.8-.7-.7 4.3-4.4z" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2h2v5h5v2H9v5H7V9H2V7h5V2z" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 2 8 6.6 12.6 2 14 3.4 9.4 8 14 12.6 12.6 14 8 9.4 3.4 14 2 12.6 6.6 8 2 3.4 3.4 2z" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 1.5h4l1 1.5h3v2H2v-2h3l1-1.5zM3 6h10l-1 8.5H4L3 6zm3 1.5v6h1.2v-6H6zm2.8 0v6H10v-6H8.8z" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 5.5h9.6L8 11.2 3.2 5.5z" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 3.2v9.6L11.2 8 5.5 3.2z" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 2 1 8l6 6v-4h8V6H7V2z" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 2v4H1v4h8v4l6-6-6-6z" />
    </Svg>
  );
}

export function ReloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5a5.5 5.5 0 0 1 4.6 2.4l1.6-1.6v4.7H9.5L11.4 6A4 4 0 1 0 12 8h1.5A5.5 5.5 0 1 1 8 2.5z" />
    </Svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.4 1 15 8 1.4 15l1.6-5.5L9 8 3 6.5 1.4 1z" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3h10v10H3z" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3h3.5v10H3V3zm6.5 0H13v10H9.5V3z" />
    </Svg>
  );
}

export function AttachIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 2.5a3.5 3.5 0 0 1 3.5 3.5v6a3 3 0 0 1-6 0V5.5h1.5V12a1.5 1.5 0 0 0 3 0V6a2 2 0 1 0-4 0v6.5a.5.5 0 0 1-1 0V6a3 3 0 0 1 3-3z" />
    </Svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 1.5h6.5L13 5v9.5H3v-13zm6 1v3h3l-3-3z" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 1.6c-1 0-2.2 1.4-2.6 3.4h5.2c-.4-2-1.6-3.4-2.6-3.4zM3.7 6.5a8 8 0 0 0-.2 1.5c0 .5.1 1 .2 1.5h2.6a14 14 0 0 1 0-3H3.7zm4 0a13 13 0 0 0 0 3h2.6a13 13 0 0 0 0-3H7.7zm4 0a14 14 0 0 1 0 3h2.6c.1-.5.2-1 .2-1.5s-.1-1-.2-1.5h-2.6zM5.4 11c.4 2 1.6 3.4 2.6 3.4S10.2 13 10.6 11H5.4z" />
    </Svg>
  );
}

export function GitBranchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2a2 2 0 0 1 .8 3.8v4.4a2 2 0 1 1-1.6 0V5.8A2 2 0 0 1 4 2zm8 0a2 2 0 0 1 .8 3.8C12.6 8.5 10.5 9 8.8 9.2A2 2 0 1 1 7.4 7.7c1.5-.2 3.2-.6 3.7-2A2 2 0 0 1 12 2z" />
    </Svg>
  );
}

export function PanelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 2.5h12v11H2v-11zm1.5 1.5v8h3v-8h-3z" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 1.4 14.6 14 13.4 15.2 11 12.8a8 8 0 0 1-3 .6c-3.5 0-6.4-2.5-7-5.4a7.5 7.5 0 0 1 2.7-3.6L.8 2.6 2 1.4zm6 3a3 3 0 0 1 3 3c0 .4 0 .7-.2 1l-1.4-1.4a1.5 1.5 0 0 0-2-2L6 2.6a8 8 0 0 1 2-.2c3.5 0 6.4 2.5 7 5.4a7.5 7.5 0 0 1-2.5 3.4L11 9.6a3 3 0 0 0-3-5.2z" />
    </Svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6.5h2v3H3v-3zm4 0h2v3H7v-3zm4 0h2v3h-2v-3z" />
    </Svg>
  );
}
