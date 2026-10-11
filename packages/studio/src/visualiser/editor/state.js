import { types, flow, getSnapshot } from "mobx-state-tree";
import { autorun } from "mobx";

import api from "../../utils/builderAPI";
import UIState from "./ui-state";
import CodeState from "./code-state";
import SelectedInfo from "./selected-info";

import codeInit from "./codeInit";
import { applyPatchToConfig, mergeParams } from "../../external/params";
import { createRebuildQueue } from "../../external/rebuildQueue";
import { snapshotState } from "../../external/snapshot";

const AppState = types
  .model("AppState", {
    ui: UIState,
    code: CodeState,
    selectedInfo: SelectedInfo,
    config: types.optional(
      types.model({
        code: types.optional(types.string, ""),
      }),
      {}
    ),
  })
  .views((self) => ({
    get currentValues() {
      return getSnapshot(self.config);
    },
    get hasError() {
      return !!self.error.error;
    },

    get codeInitialized() {
      return !!self.config.code;
    },

    /**
     * Full parameter object for the next rebuild. `undefined` keeps the
     * script's own defaults. A stored patch is merged onto those defaults.
     */
    get effectiveParams() {
      if (!self.paramOverrides) return undefined;
      return mergeParams(self.scriptDefaults, null, self.paramOverrides);
    },
  }))
  .volatile(() => ({
    defaultParams: null,
    scriptDefaults: null,
    paramOverrides: null,
    externalCode: false,
    currentMesh: [],
    processing: false,
    shapeLoaded: false,
    error: false,
    compatibilityWarning: null,
    faceInfo: null,
    processingInfo: null,
  }))
  .actions((self) => ({
    updateCode(newCode) {
      self.config.code = newCode;
    },

    markExternalCode() {
      self.externalCode = true;
    },

    setParamOverrides(params) {
      self.paramOverrides = params ? { ...params } : null;
    },

    clearParamOverrides() {
      self.paramOverrides = null;
      if (self.scriptDefaults) {
        self.defaultParams = self.scriptDefaults;
      }
    },

    initCode: flow(function* () {
      const code = yield codeInit();
      // An outside caller may have loaded a script while the URL/local
      // default was still being read. Keep that script.
      if (self.externalCode) return;
      self.updateCode(code);
    }),

    ensureDefaultParams: flow(function* () {
      if (self.scriptDefaults) return self.scriptDefaults;
      try {
        const extracted = yield api.extractDefaultParamsFromCode(
          self.currentValues.code
        );
        self.scriptDefaults = extracted || null;
        if (!self.defaultParams) self.defaultParams = extracted || null;
      } catch (_e) {
        self.scriptDefaults = null;
      }
      return self.scriptDefaults;
    }),

    process: flow(function* process(params) {
      self.ui.deHighlight();
      self.processing = true;

      let buildParams = params;
      if (buildParams === undefined && self.paramOverrides) {
        if (!self.scriptDefaults) {
          try {
            self.scriptDefaults = yield api.extractDefaultParamsFromCode(
              self.currentValues.code
            );
          } catch (_e) {
            self.scriptDefaults = null;
          }
        }
        buildParams = self.effectiveParams;
      }

      try {
        const { shapes: mesh, compatibilityReplacements: replacements } =
          yield api.buildShapesFromCodeWithMetadata(
            self.currentValues.code,
            buildParams
          );
        self.compatibilityWarning = replacements.length
          ? `OpenCascade compatibility mode was used (${replacements
              .map(({ legacy, replacement }) => `${legacy} → ${replacement}`)
              .join(
                ", "
              )}). Please update your code to use the unnumbered API names.`
          : null;

        if (mesh.error) {
          self.error = mesh;
        } else {
          self.currentMesh = mesh;
          self.error = false;
        }

        self.shapeLoaded = true;
      } catch (e) {
        console.error(e);
        self.error = e;
        self.compatibilityWarning = null;
      }

      try {
        const extracted = yield api.extractDefaultParamsFromCode(
          self.currentValues.code
        );
        self.scriptDefaults = extracted || null;
        self.defaultParams = applyPatchToConfig(
          extracted,
          self.paramOverrides
        );
      } catch (e) {
        console.log("no default params");
      }

      self.processing = false;
    }),
  }))
  .extend((self) => {
    let disposer = null;

    // Latest queued arguments win, and every caller waits for the run that
    // includes its request. Code edits (the autorun below) and the external
    // control API share this queue.
    const queue = createRebuildQueue(async (params) => {
      await self.process(params);
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("replicad-studio", { detail: snapshotState(self) })
        );
      }
    });

    const run = () => {
      if (!self.currentValues.code) return;
      queue.enqueue();
    };

    return {
      actions: {
        afterCreate() {
          disposer = autorun(run);
        },

        afterDestroy() {
          if (disposer) disposer();
        },

        rebuild(params) {
          return queue.enqueue(params);
        },

        whenSettled() {
          return queue.whenSettled();
        },
      },
    };
  });

export default AppState;
