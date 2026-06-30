import localFont from "next/font/local";

/**
 * Self-hosted Material Symbols Outlined variable font (BRAND §5).
 *
 * Setup (one-time): download the variable font and place it at
 *   public/fonts/MaterialSymbolsOutlined.woff2
 * from https://github.com/google/material-design-icons (variablefont build).
 * Default axis: FILL 0, wght 400, GRAD 0, opsz 24.
 *
 * Fallback: if a glyph is missing, import the matching icon from
 * `lucide-react` (already a dependency). Do not mix systems visibly —
 * prefer Material Symbols everywhere it has the glyph.
 */
export const materialSymbols = localFont({
  src: "../public/fonts/MaterialSymbolsOutlined.woff2",
  display: "block",
  variable: "--font-icons",
  weight: "100 700",
});
