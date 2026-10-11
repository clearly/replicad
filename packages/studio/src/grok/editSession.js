import { createEditApplier, isUndoRequest, undoLast } from "./applyEdit.js";
import { runEdit } from "./client.js";

export function createEditSession({
  credentials,
  studio,
  getFacts,
  run = runEdit,
  history = [],
}) {
  return {
    history,

    async submit(text) {
      const trimmed = (text || "").trim();
      if (!trimmed) throw new Error("Say or type a change first");

      if (isUndoRequest(trimmed)) {
        const state = await undoLast(studio, history);
        if (!state) throw new Error("Nothing to undo");
        return { summary: "Undid the last change." };
      }

      const token = credentials.token();
      const status = credentials.status();
      if (!token || !status.connected) {
        throw new Error("Connect Grok first");
      }

      const before = studio.getState();
      history.push({ code: before.code, params: before.params });
      if (history.length > 30) history.shift();

      try {
        return await run({
          token,
          endpoint: status.endpoint,
          model: status.model,
          userText: trimmed,
          getContext: () => {
            const state = studio.getState();
            return {
              code: state.code,
              params: state.params,
              defaults: state.defaults,
              error: state.error,
              geometry: getFacts(),
            };
          },
          applyTool: createEditApplier(studio, getFacts),
        });
      } catch (error) {
        history.pop();
        throw error;
      }
    },
  };
}
