import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function showStartupError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error && error.stack ? `\n\n${error.stack}` : "";
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";

  const pre = document.createElement("pre");
  pre.style.cssText = [
    "box-sizing:border-box",
    "height:100vh",
    "margin:0",
    "padding:28px",
    "overflow:auto",
    "white-space:pre-wrap",
    "font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#8a1f11",
    "background:#fff8f6",
  ].join(";");
  pre.textContent = `Hebe startup error\n\n${message}${stack}`;
  root.appendChild(pre);
}

window.addEventListener("error", (event) => {
  showStartupError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showStartupError(event.reason);
});

if ("__TAURI_INTERNALS__" in window) {
  window.requestIdleCallback = (callback) =>
    window.setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        }),
      300,
    );
  window.cancelIdleCallback = (id) => window.clearTimeout(id);
}

import("./App")
  .then(({ default: App }) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch(showStartupError);
