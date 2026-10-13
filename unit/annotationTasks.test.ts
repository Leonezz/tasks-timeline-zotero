import { describe, expect, it } from "vitest";
import {
  annotationQuote,
  proposeTasksFromAnnotations,
} from "../src/ai/annotationTasks";

const todo = {
  key: "ANN00001",
  text: "multi-head attention",
  comment: "TODO: compare with RNNs",
  pageLabel: "3",
};

describe("proposeTasksFromAnnotations", () => {
  it("turns marked annotations into tasks and ignores the rest", () => {
    const { proposals, alreadyTasks } = proposeTasksFromAnnotations(
      [todo, { key: "ANN00002", text: "just a highlight", comment: "nice" }],
      [],
    );
    expect(alreadyTasks).toBe(0);
    expect(proposals).toEqual([
      {
        annotationKey: "ANN00001",
        title: "compare with RNNs",
        description: "From an annotation on p. 3: “multi-head attention”",
      },
    ]);
  });

  it("recognizes common markers", () => {
    const titles = proposeTasksFromAnnotations(
      [
        { key: "A1", comment: "todo check the proof" },
        { key: "A2", comment: "待办：复现实验" },
        { key: "A3", comment: "[ ] email the authors" },
        { key: "A4", comment: "FIXME wrong citation" },
        { key: "A5", comment: "mastodon" },
      ],
      [],
    ).proposals.map((p) => p.title);
    expect(titles).toEqual([
      "check the proof",
      "复现实验",
      "email the authors",
      "wrong citation",
    ]);
  });

  it("uses the highlighted text when the comment is only a marker", () => {
    const { proposals } = proposeTasksFromAnnotations(
      [{ key: "A1", text: "Section 4 ablation", comment: "TODO" }],
      [],
    );
    expect(proposals[0].title).toBe("Section 4 ablation");
  });

  it("matches a custom keyword instead of the markers", () => {
    const { proposals } = proposeTasksFromAnnotations(
      [
        { key: "A1", comment: "follow up: dataset size" },
        { key: "A2", comment: "TODO other" },
      ],
      [],
      "follow up",
    );
    expect(proposals.map((p) => p.annotationKey)).toEqual(["A1"]);
  });

  it("skips annotations that already became tasks", () => {
    const existing = [`Compare with RNNs\n[ ]\n${annotationQuote(todo)}`];
    expect(proposeTasksFromAnnotations([todo], existing)).toEqual({
      proposals: [],
      alreadyTasks: 1,
    });
  });
});
