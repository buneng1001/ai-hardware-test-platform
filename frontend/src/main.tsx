import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { FrontendRoot } from "./FrontendRoot";
import "./styles.css";
import "./V020PrototypeEnhancements.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到前端挂载节点");
}

createRoot(root).render(
  <StrictMode>
    <FrontendRoot />
  </StrictMode>,
);
