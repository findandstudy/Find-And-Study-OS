export interface PageEditorPreviewGeometry {
  scale: number;
  height: number;
}

/**
 * Derive preview geometry from the host border-box width. Unlike clientWidth,
 * the border-box width does not oscillate when the preview gains or loses a
 * scrollbar, so it cannot feed a ResizeObserver render loop.
 */
export function pageEditorPreviewGeometry(
  hostBorderBoxWidth: number,
  targetWidth: number,
  canvasScrollHeight: number,
): PageEditorPreviewGeometry {
  const safeHostWidth = Number.isFinite(hostBorderBoxWidth) ? Math.floor(hostBorderBoxWidth) : 0;
  const safeTargetWidth = Number.isFinite(targetWidth) && targetWidth > 0 ? targetWidth : 1;
  const safeCanvasHeight = Number.isFinite(canvasScrollHeight) ? Math.ceil(canvasScrollHeight) : 0;
  const availableWidth = Math.max(280, safeHostWidth - 32);

  return {
    scale: Math.min(1, availableWidth / safeTargetWidth),
    height: Math.max(400, safeCanvasHeight),
  };
}

export function samePageEditorPreviewGeometry(
  current: PageEditorPreviewGeometry,
  next: PageEditorPreviewGeometry,
): boolean {
  return Math.abs(current.scale - next.scale) < 0.001 && current.height === next.height;
}
