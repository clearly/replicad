import { describe, expect, test } from "vitest";
import opencascade from "replicad-opencascadejs";
import * as replicad from "../../replicad/src/index";
import * as shapeFns from "../../replicad/src/shapeFunctions/index";
import { createEvaluator } from "../src/index";
import { wasmHeapBytes } from "../src/builder";

const createTestEvaluator = () =>
  createEvaluator({
    replicad,
    shapeFns,
    oc: globalThis.replicadEvaluatorOC,
    tempDir: "/tmp",
  });

const BOX = `const main = ({ makeBaseBox }) => makeBaseBox(12, 8, 6);`;

describe("repeated rebuild memory", () => {
  test("a later build deletes the previous OpenCascade shape", async () => {
    const evaluator = createTestEvaluator();
    await evaluator.buildShapesFromCode(BOX, {});
    const [entry] = evaluator.getShapeEntries();
    const previous = entry.shape;

    await evaluator.buildShapesFromCode(BOX, {});

    expect(() => previous.wrapped).toThrow(/deleted/);
    expect(evaluator.getShapeEntries()[0].shape).not.toBe(previous);
  });

  test("worker recycle resets the wasm heap that shape.delete does not shrink", async () => {
    const oc = globalThis.replicadEvaluatorOC;
    const { makeBaseBox } = replicad;
    // Enough boxes to push this build past its initial wasm memory.
    const rounds = 5000;
    const before = wasmHeapBytes(oc);
    const retained = [];
    try {
      for (let i = 0; i < rounds; i += 1) {
        retained.push(makeBaseBox(10, 10, 10));
      }
      const afterRetain = wasmHeapBytes(oc);
      retained.forEach((shape) => shape.delete());
      const afterDelete = wasmHeapBytes(oc);

      const fresh = await opencascade();
      const afterRecycle = wasmHeapBytes(fresh);

      console.log(
        JSON.stringify({
          rounds,
          before,
          afterRetain,
          retainedGrowth: afterRetain - before,
          afterDelete,
          deleteShrink: afterDelete - afterRetain,
          afterRecycle,
        })
      );

      expect(afterRetain).toBeGreaterThan(before);
      // delete() drops the live shape, but this wasm heap does not shrink.
      expect(afterDelete).toBe(afterRetain);
      // A new OpenCascade instance, which is what recycling the worker does,
      // starts from the small initial heap again.
      expect(afterRecycle).toBeLessThan(afterDelete);
      expect(afterRecycle).toBeLessThanOrEqual(before);
    } finally {
      retained.forEach((shape) => {
        try {
          shape.delete();
        } catch {
          // already deleted
        }
      });
    }
  });
});
