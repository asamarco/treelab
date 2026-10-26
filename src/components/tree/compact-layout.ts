/**
 * @fileoverview
 * Shared layout values for compact tree rows. Global compact mode and the
 * two-panel explorer both render rows with these, so changing a value here
 * changes both.
 */

export const COMPACT_CHEVRON_WIDTH_PX = 20;
export const COMPACT_CHEVRON_WIDTH_MOBILE_PX = 40;

export const getCompactChevronWidthPx = (isMobile: boolean) =>
  isMobile ? COMPACT_CHEVRON_WIDTH_MOBILE_PX : COMPACT_CHEVRON_WIDTH_PX;

// Each child level is indented by this margin plus the guide border; there is no extra per-level padding.
export const getGuideMarginPx = (chevronWidthPx: number) => chevronWidthPx / 2 - 0.5;

export const COMPACT_ROW_CLASS = "my-0.5 border-0 shadow-none";
export const COMPACT_ICON_CLASS = "h-4 w-4 ml-0 mr-1";
