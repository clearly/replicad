import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { Button } from "../components/Button.jsx";
import useEditorStore from "../visualiser/editor/useEditorStore";
import { geometryFacts } from "./applyEdit.js";
import { grokCredentials } from "./credentialStore.js";
import { testConnection, transcribeAudio } from "./client.js";
import { XAI_ORIGIN } from "./endpoint.js";
import { createEditSession } from "./editSession.js";
import { redactSecret } from "./redact.js";
import {
  browserSpeechAvailable,
  createBrowserPushToTalk,
  recordUntilStopped,
} from "./speech.js";

const Bar = styled.form`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.45em;
  padding: 0.55em 0.8em 0.7em;
  border-top: 1px solid var(--color-primary-light);
  background: var(--bg-color);
  color: var(--color-text, inherit);
  font-size: 0.85rem;
`;

const Row = styled.div`
  display: flex;
  gap: 0.4em;
  align-items: center;
  flex-wrap: wrap;
`;

const Field = styled.input`
  flex: 1 1 12em;
  min-width: 8em;
  font: inherit;
  padding: 0.35em 0.5em;
  border: 1px solid var(--color-primary-light);
  border-radius: 0.2em;
  background: var(--bg-color);
  color: inherit;
`;

const Status = styled.div`
  opacity: 0.85;
  min-height: 1.2em;
`;

const Label = styled.label`
  display: flex;
  gap: 0.35em;
  align-items: center;
`;

function safeMessage(error, token) {
  return redactSecret(error?.message || "Something went wrong", token);
}

export default function GrokPanel() {
  const store = useEditorStore();
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState(grokCredentials.status());
  const [saved, setSaved] = useState(false);
  const [endpoint, setEndpoint] = useState(XAI_ORIGIN);
  const [model, setModel] = useState("grok-4.7");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [useBrowserSpeech, setUseBrowserSpeech] = useState(
    () => !browserSpeechAvailable()
  );
  const sessionRef = useRef(null);
  const talkRef = useRef(null);
  const recordingRef = useRef(null);

  if (!sessionRef.current && typeof window !== "undefined" && window.replicadStudio) {
    sessionRef.current = createEditSession({
      credentials: grokCredentials,
      studio: window.replicadStudio,
      getFacts: () => geometryFacts(store),
    });
  }

  useEffect(() => {
    let cancelled = false;
    grokCredentials.hasSavedRecord().then((has) => {
      if (!cancelled) setSaved(has);
    });
    return () => {
      cancelled = true;
    };
  }, [status.connected, status.remembered]);

  const refresh = () => setStatus(grokCredentials.status());

  const connectNew = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNote("Checking the connection…");
    const entered = token;
    try {
      await testConnection({ token: entered, endpoint });
      await grokCredentials.save({
        endpoint,
        token: entered,
        model,
        remember,
      });
      setToken("");
      refresh();
      setNote(
        remember
          ? "Connected. The token is encrypted in this browser."
          : "Connected for this session only."
      );
    } catch (error) {
      setNote(safeMessage(error, entered));
    } finally {
      setBusy(false);
    }
  };

  const connectSaved = async () => {
    setBusy(true);
    setNote("Loading the saved connection…");
    try {
      const loaded = await grokCredentials.loadSaved();
      if (!loaded) {
        setNote("No saved connection on this device.");
        return;
      }
      const savedToken = grokCredentials.token();
      await testConnection({
        token: savedToken,
        endpoint: loaded.endpoint,
      });
      refresh();
      setNote("Connected with the saved token.");
    } catch (error) {
      const savedToken = grokCredentials.token();
      grokCredentials.disconnect();
      refresh();
      setNote(safeMessage(error, savedToken));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    grokCredentials.disconnect();
    refresh();
    setNote("Disconnected. The saved token is still on this device.");
  };

  const forget = async () => {
    await grokCredentials.forget();
    refresh();
    setSaved(false);
    setNote("Forgot the saved Grok connection.");
  };

  const sendText = async (text) => {
    const session = sessionRef.current;
    if (!session) {
      setNote("The workbench is not ready yet.");
      return;
    }
    setBusy(true);
    setNote("Asking Grok…");
    try {
      const result = await session.submit(text);
      setDraft("");
      setNote(result.summary || "Updated the model.");
    } catch (error) {
      setNote(safeMessage(error, grokCredentials.token()));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    sendText(draft);
  };

  const stopListening = async () => {
    if (!listening) return;
    setListening(false);

    if (talkRef.current) {
      const talk = talkRef.current;
      talkRef.current = null;
      talk.stop();
      return;
    }

    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;
    setBusy(true);
    try {
      const blob = await recording.stop();
      const text = await transcribeAudio({
        token: grokCredentials.token(),
        blob,
      });
      setDraft(text);
      setNote(text ? "Heard you." : "No speech detected.");
      if (text) await sendText(text);
    } catch (error) {
      setNote(safeMessage(error, grokCredentials.token()));
    } finally {
      setBusy(false);
    }
  };

  const startListening = async () => {
    if (listening || busy) return;
    if (!status.connected && !browserSpeechAvailable()) {
      setNote("Connect Grok to transcribe, or type the change.");
      return;
    }

    const preferBrowser = useBrowserSpeech && browserSpeechAvailable();
    if (preferBrowser || !status.connected) {
      const talk = createBrowserPushToTalk(window, {
        onTranscript: (text) => setDraft(text),
        onError: (message) => setNote(message),
        onEnd: (text) => {
          if (text && status.connected) sendText(text);
          else if (text) setNote("Transcript ready. Connect Grok to apply it.");
        },
      });
      if (!talk.available) {
        setNote("This browser has no speech recognition.");
        return;
      }
      talkRef.current = talk;
      talk.start();
      setListening(true);
      setNote("Listening…");
      return;
    }

    try {
      recordingRef.current = await recordUntilStopped(window);
      setListening(true);
      setNote("Recording for xAI transcription…");
    } catch (error) {
      setNote(safeMessage(error, null));
    }
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.ctrlKey && event.shiftKey && event.code === "Space")) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (target?.closest?.(".monaco-editor")) return;
      event.preventDefault();
      if (listening) stopListening();
      else startListening();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Bar onSubmit={onSubmit}>
      <Row>
        <Button type="button" small outlined onClick={() => setOpen((value) => !value)}>
          {open ? "Hide Grok" : "Grok voice"}
        </Button>
        <Status>
          {status.connected
            ? `Connected to ${status.endpoint}`
            : saved
            ? "Saved connection on this device"
            : "Not connected"}
        </Status>
      </Row>
      {open && !status.connected && (
        <>
          <Row>
            <Field
              aria-label="Grok endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              autoComplete="off"
            />
            <Field
              aria-label="Grok model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              autoComplete="off"
            />
          </Row>
          <Row>
            <Field
              aria-label="Grok API token"
              type="password"
              value={token}
              placeholder={saved ? "Replace token" : "API token"}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember on this device
            </Label>
            <Button type="button" small solid disabled={busy || !token.trim()} onClick={connectNew}>
              Connect
            </Button>
            {saved && (
              <Button type="button" small disabled={busy} onClick={connectSaved}>
                Use saved
              </Button>
            )}
          </Row>
        </>
      )}
      {open && status.connected && (
        <Row>
          <Button type="button" small onClick={disconnect}>
            Disconnect
          </Button>
          <Button type="button" small onClick={forget}>
            Forget
          </Button>
          {browserSpeechAvailable() && (
            <Label>
              <input
                type="checkbox"
                checked={useBrowserSpeech}
                onChange={(event) => setUseBrowserSpeech(event.target.checked)}
              />
              Browser speech
            </Label>
          )}
        </Row>
      )}
      {open && (
        <Row>
          <Button
            type="button"
            small
            solid={listening}
            onPointerDown={(event) => {
              event.preventDefault();
              startListening();
            }}
            onPointerUp={stopListening}
            onPointerLeave={() => {
              if (listening) stopListening();
            }}
          >
            {listening ? "Release to send" : "Hold to talk"}
          </Button>
          <Field
            aria-label="Edit request"
            value={draft}
            placeholder='Describe a change, or say "undo"'
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" small solid disabled={busy || !draft.trim()}>
            Send
          </Button>
        </Row>
      )}
      {open && <Status>{note}</Status>}
    </Bar>
  );
}
