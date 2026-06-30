import type { JSX } from "react";
import { Icon } from "@/components/ui/Icon";
import { fillPercent, nodeState, STEPPER_NODES } from "@/lib/ui/stepper";

const NODE_CLASSES: Record<"future" | "active" | "complete", string> = {
  future: "bg-surface border-2 border-outline text-on-surface-variant",
  active: "bg-surface border-2 border-primary text-primary shadow-lg shadow-primary/10",
  complete: "bg-primary border-2 border-primary text-on-primary",
};

export function Stepper({ current }: { current: number }): JSX.Element {
  const total = STEPPER_NODES.length;
  return (
    <div className="relative px-2 py-6">
      {/* track + fill behind the nodes */}
      <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-0.5 bg-outline-variant" aria-hidden="true">
        <div
          className="h-full bg-primary trx-stepper-fill"
          style={{ width: `${fillPercent(current, total)}%` }}
        />
      </div>
      <ol className="relative flex items-center justify-between">
        {STEPPER_NODES.map((node, i) => {
          const state = nodeState(i, current);
          return (
            <li key={node.key} className="flex flex-col items-center gap-2">
              <span
                aria-current={state === "active" ? "step" : undefined}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${NODE_CLASSES[state]}`}
              >
                {state === "complete" ? (
                  <Icon name="check" className="text-[20px]" />
                ) : (
                  <span className="font-mono text-body-sm font-bold">{i + 1}</span>
                )}
              </span>
              <span className="text-label-mono uppercase tracking-widest font-bold text-on-surface-variant/70">
                {node.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
