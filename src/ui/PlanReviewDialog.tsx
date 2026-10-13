import { useState } from "react";
import type { PlanForReview } from "../shared/uiContract";

export interface PendingReview {
  plan: PlanForReview;
  resolve: (selected: number[] | null) => void;
}

/**
 * Lets the user pick which proposed writes an AI tool may apply. Nothing is
 * written until "Create" is pressed; closing or cancelling writes nothing.
 */
export function PlanReviewDialog({ review }: { review: PendingReview }) {
  const { plan, resolve } = review;
  const [checked, setChecked] = useState(() => plan.choices.map(() => true));
  const selected = checked.flatMap((on, index) => (on ? [index] : []));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={plan.title}
      className="fixed inset-0 flex items-center justify-center p-3"
      // Not in the component library's compiled Tailwind CSS, so inline.
      style={{ zIndex: 10000, backgroundColor: "rgba(0, 0, 0, 0.3)" }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-4 shadow-xl"
        style={{ maxHeight: "100%" }}
      >
        <h2 className="text-sm font-semibold text-slate-800">{plan.title}</h2>
        {plan.choices.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing to create.</p>
        ) : (
          <ul className="flex flex-col gap-2 overflow-auto">
            {plan.choices.map((choice, index) => (
              <li key={index}>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={choice.label}
                    checked={checked[index]}
                    onChange={(e) =>
                      setChecked((prev) =>
                        prev.map((v, i) =>
                          i === index ? e.target.checked : v,
                        ),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium text-slate-800">
                      {choice.label}
                    </span>
                    {choice.detail && (
                      <span className="block text-xs text-slate-500">
                        {choice.detail}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600"
            onClick={() => resolve(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={selected.length === 0}
            onClick={() => resolve(selected)}
          >
            {`Create ${selected.length} ${selected.length === 1 ? "task" : "tasks"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
