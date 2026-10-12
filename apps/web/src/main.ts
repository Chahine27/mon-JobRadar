import { createApp } from "vue";
import App from "./App.vue";
import { setUnauthorizedHandler } from "./api";
import { router } from "./router";
import { setLoggedOut } from "./session";
import "./styles.css";
import { initTheme } from "./theme";

initTheme();

setUnauthorizedHandler(() => {
  setLoggedOut();
  if (router.currentRoute.value.name !== "login") {
    void router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
  }
});

createApp(App).use(router).mount("#app");
