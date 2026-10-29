import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/base.css";
import "./styles/pulse.css";
import "./styles/interactions.css";
import "./styles/liquid-glass.css";
import "./styles/jarvis.css";
import "./styles/neural.css";
import "./styles/workspace.css";

createRoot(document.getElementById("root")!).render(<App />);
