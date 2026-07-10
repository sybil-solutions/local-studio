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

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3h10v10H3z" />
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
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="8" cy="8" rx="3" ry="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 8h13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.3 5h11.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.3 11h11.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
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

export function SitegeistIcon(props: IconProps) {
  // "site" + "zeitgeist" → an eye watching a page. The almond eye outline holds
  // a solid iris, echoing the sitegeist orb mark. Single-color, no strokes.
  return (
    <Svg {...props}>
      <path d="M8 2.5c3.4 0 6.2 2.2 7.5 5.5C14.2 11.3 11.4 13.5 8 13.5S1.8 11.3.5 8C1.8 4.7 4.6 2.5 8 2.5zm0 1.8a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4zm0 1.8a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z" />
    </Svg>
  );
}

export function PanelIcon(props: IconProps) {
  // A bordered panel split into a sidebar + content area — the embedded browser
  // panel. Solid frame, hollow content well.
  return (
    <Svg {...props}>
      <path d="M2 2.5h12v11H2v-11zm1.5 1.5v8H6v-8H3.5zm4 0v8H12.5v-8H7.5z" />
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
