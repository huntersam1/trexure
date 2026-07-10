/**
 * Pure geometry for the flow map's SVG connector layer. Rects are
 * DOMRect-shaped but plain objects so this stays testable without a DOM;
 * anchors are expressed relative to the container's rect (`origin`).
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type Anchor = { x: number; y: number };

export function rightAnchor(node: Rect, origin: Rect): Anchor {
  return { x: node.left - origin.left + node.width, y: node.top - origin.top + node.height / 2 };
}

export function leftAnchor(node: Rect, origin: Rect): Anchor {
  return { x: node.left - origin.left, y: node.top - origin.top + node.height / 2 };
}

const MIN_BEND = 24;

export function connectorPath(from: Anchor, to: Anchor): string {
  const bend = Math.max((to.x - from.x) / 2, MIN_BEND);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}
