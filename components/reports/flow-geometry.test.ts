import { describe, it, expect } from "vitest";

import { connectorPath, leftAnchor, rightAnchor } from "./flow-geometry";

const ORIGIN = { left: 100, top: 50, width: 800, height: 600 };

describe("anchors", () => {
  it("rightAnchor is the vertical midpoint of the node's right edge, relative to origin", () => {
    expect(rightAnchor({ left: 130, top: 80, width: 140, height: 40 }, ORIGIN)).toEqual({ x: 170, y: 50 });
  });

  it("leftAnchor is the vertical midpoint of the node's left edge, relative to origin", () => {
    expect(leftAnchor({ left: 400, top: 200, width: 110, height: 30 }, ORIGIN)).toEqual({ x: 300, y: 165 });
  });
});

describe("connectorPath", () => {
  it("emits a cubic bezier with horizontal control points at half the x-distance", () => {
    expect(connectorPath({ x: 170, y: 50 }, { x: 300, y: 165 })).toBe("M 170 50 C 235 50, 235 165, 300 165");
  });

  it("keeps a minimum bend so near-vertical connectors still curve", () => {
    expect(connectorPath({ x: 100, y: 10 }, { x: 110, y: 200 })).toBe("M 100 10 C 124 10, 86 200, 110 200");
  });
});
