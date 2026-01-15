import type { RouteRecordRaw } from "vue-router";
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/mobile/Home.vue"),
    redirect: "/resource",
    children: [
      {
        path: "/resource",
        name: "resource",
        component: () => import("@/views/mobile/ResourceList.vue"),
      },
      {
        path: "/douban",
        name: "douban",
        component: () => import("@/views/mobile/Douban.vue"),
      },
      {
        path: "/setting",
        name: "setting",
        component: () => import("@/views/mobile/Setting.vue"),
      },
      {
        path: "/thanks",
        name: "thanks",
        redirect: "/resource",
      },
    ],
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/mobile/Login.vue"),
  },
];

export default routes;
