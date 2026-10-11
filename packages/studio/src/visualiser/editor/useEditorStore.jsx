import React from "react";
import { createContext, useContext } from "react";
import AppState from "./state";
import { attachExternalControl } from "../../external/createExternalControl";

const store = AppState.create();

// One page-level handle for outside code (window.replicadStudio / postMessage).
// Attached with the store so both the workbench and the visualiser share it.
if (typeof window !== "undefined") {
  attachExternalControl(store);
}

export const EditorContext = createContext(store);

export const EditorContextProvider = (props) => {
  return <EditorContext.Provider value={store} {...props} />;
};

export default function useEditorState() {
  return useContext(EditorContext);
}
