import React from "react";
import ReactDOM from "react-dom/client";

import { bootstrapApplication } from "./bootstrap/bootstrap-app";
import { App } from "./app/App";
import "./app/styles.css";
import "./app/workbench-native.css";

void bootstrapApplication().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <App />
  );
});
