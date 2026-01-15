import { createRouter, createWebHistory } from "vue-router";
import mobileRoutes from "./mobile-routes";
import pcRoutes from "./pc-routes";
import { isMobileDevice } from "@/utils/index";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...(isMobileDevice() ? mobileRoutes : pcRoutes)],
});

export default router;
