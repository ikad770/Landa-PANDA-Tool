import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

function BootFallback({ error }) {
  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif", color: "#111" }}>
      <h1>Landa PANDA Tool loaded, but UI failed to initialize</h1>
      <pre style={{ whiteSpace: "pre-wrap", color: "#b00020" }}>
        {String(error?.stack || error)}
      </pre>
    </div>
  );
}

const rootElement = document.getElementById("root");

try {
  if (!rootElement) {
    throw new Error("Missing #root element in index.html");
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error(error);
  if (rootElement) {
    createRoot(rootElement).render(<BootFallback error={error} />);
  }
}
