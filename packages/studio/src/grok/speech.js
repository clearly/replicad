export function browserSpeechAvailable(root = window) {
  return Boolean(root.SpeechRecognition || root.webkitSpeechRecognition);
}

/**
 * Push-to-talk over the browser SpeechRecognition API.
 * Interim text is reported as the user speaks. This path does not receive
 * the Grok token.
 */
export function createBrowserPushToTalk(root, handlers) {
  const Ctor = root.SpeechRecognition || root.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let finalText = "";

  const stop = () => {
    listening = false;
    try {
      recognition?.stop();
    } catch (_error) {
      // stop() throws if recognition was already stopped.
    }
  };

  return {
    available: Boolean(Ctor),
    start() {
      if (!Ctor || listening) return;
      finalText = "";
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) finalText = `${finalText} ${piece}`.trim();
          else interim = `${interim} ${piece}`.trim();
        }
        handlers.onTranscript?.(`${finalText} ${interim}`.trim());
      };
      recognition.onerror = (event) => {
        handlers.onError?.(event?.error || "speech error");
      };
      recognition.onend = () => {
        listening = false;
        handlers.onEnd?.(finalText.trim());
      };
      recognition.start();
      listening = true;
    },
    stop,
  };
}

export async function recordUntilStopped(root = window) {
  if (!root.navigator?.mediaDevices?.getUserMedia) {
    throw new Error("This browser has no microphone API");
  }
  const stream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
  const Recorder = root.MediaRecorder;
  if (!Recorder) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("This browser cannot record audio");
  }

  const recorder = new Recorder(stream);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || "audio/webm";
      resolve(new root.Blob(chunks, { type }));
    };
  });

  recorder.start();
  return {
    async stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
  };
}
