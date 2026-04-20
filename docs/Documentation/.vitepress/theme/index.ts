import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";

import DocImage from "./components/DocImage.vue";
import Layout from "./Layout.vue";
import "./custom.css";

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("DocImage", DocImage);
  }
};

export default theme;
