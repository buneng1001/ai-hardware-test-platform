import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FrontendRoot } from "./FrontendRoot";
import "./styles.css";
import "./V020PrototypeEnhancements.css";
import "./V020PrototypeTheme.css";
import "./V020PrototypeWorkspace.css";
import "./V020PrototypeComponents.css";
import "./V020PrototypeCases.css";
import "./V020PrototypeResponsive.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到前端挂载节点");
}

createRoot(root).render(
  <StrictMode>
    <FrontendRoot />
  </StrictMode>,
);
