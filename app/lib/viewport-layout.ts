export interface Size {
  width: number;
  height: number;
}

export interface VisualViewportSnapshot {
  height?: number;
  offsetTop?: number;
}

export interface ViewportSnapshot {
  innerHeight?: number;
  visualViewport?: VisualViewportSnapshot | null;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function resolveViewportCssVars(snapshot: ViewportSnapshot): Record<string, string> {
  const visual = snapshot.visualViewport;
  const height = finitePositive(visual?.height)
    ? visual.height
    : finitePositive(snapshot.innerHeight)
      ? snapshot.innerHeight
      : 0;
  const offsetTop = finiteNonNegative(visual?.offsetTop) ? visual.offsetTop : 0;

  return {
    "--app-viewport-height": height > 0 ? `${height}px` : "100dvh",
    "--app-viewport-offset-top": `${offsetTop}px`,
  };
}

export function containWithin({
  source,
  bounds,
  maxScale,
}: {
  source: Size;
  bounds: Size;
  maxScale?: number;
}): Size {
  if (
    !finitePositive(source.width) ||
    !finitePositive(source.height) ||
    !finitePositive(bounds.width) ||
    !finitePositive(bounds.height)
  ) {
    return { width: 0, height: 0 };
  }

  const boundScale = Math.min(bounds.width / source.width, bounds.height / source.height);
  const scale = finitePositive(maxScale) ? Math.min(boundScale, maxScale) : boundScale;
  return {
    width: source.width * scale,
    height: source.height * scale,
  };
}
