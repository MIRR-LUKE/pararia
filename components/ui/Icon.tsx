import type { ReactElement } from "react";

type IconName =
  | "users"
  | "bolt"
  | "logs"
  | "filter"
  | "list"
  | "calendar"
  | "report"
  | "upload"
  | "plus"
  | "search"
  | "shield"
  | "target"
  | "arrowLeft"
  | "info";

const paths: Record<IconName, ReactElement> = {
  users: (
    <>
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M15 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M2.5 18c0-2.2 2.5-4 5.5-4s5.5 1.8 5.5 4" />
      <path d="M12.5 18c0-1.66 1.57-3 3.5-3 1.3 0 2.44.5 3.12 1.25" />
    </>
  ),
  bolt: (
    <>
      <path d="M13 2 6 12h5l-1 8 7-10h-5l1-8Z" />
    </>
  ),
  logs: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M6 12h12M10 18h4" />
      <circle cx="10" cy="12" r="1.2" />
      <circle cx="14" cy="6" r="1.2" />
      <circle cx="12" cy="18" r="1.2" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h10M9 12h10M9 18h10" />
      <circle cx="5" cy="6" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="5" cy="18" r="1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M9 3v4M15 3v4M4 9h16" />
      <rect x="8" y="12" width="3" height="3" rx="0.6" />
      <rect x="13" y="12" width="3" height="3" rx="0.6" />
    </>
  ),
  report: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V7" />
      <path d="m8.5 10 3.5-3.5L15.5 10" />
      <path d="M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="5" />
      <path d="m15 15 4 4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5v2M12 17v2M5 12h2M17 12h2" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="m11 5-7 7 7 7" />
      <path d="M4 12h16" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
};

export function Icon({ name, size = 16, strokeWidth = 1.6 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      {paths[name]}
    </svg>
  );
}
