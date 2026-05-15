// tests/config/visualConfig.ts
// Thresholds y masks por defecto para regresion visual.
// Cada spec puede sobreescribir via options en toHaveScreenshot.

export const VISUAL_DEFAULTS = {
  // Default: 0.5% de pixeles distintos.
  maxDiffPixelRatio: 0.005,

  // Pantallas con graficos animados toleran hasta 2%.
  maxDiffPixelRatioCharts: 0.02,

  // Pantallas estaticas exigen casi 0.
  maxDiffPixelRatioStatic: 0.001,

  // Animaciones siempre desactivadas en regresion visual.
  animations: 'disabled' as const,

  // Cursor oculto para evitar variaciones por caret.
  caret: 'hide' as const
} as const;

export const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1366, height: 768 },
  tablet: { width: 1024, height: 768 }
} as const;

export type Viewport = keyof typeof VIEWPORTS;
