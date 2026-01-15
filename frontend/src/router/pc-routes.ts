import type { RouteRecordRaw } from "vue-router";
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/Home.vue"),
    redirect: "/resource",
    children: [
      {
        path: "/resource",
        name: "resource",
        component: () => import("@/views/ResourceList.vue"),
      },
      {
        path: "/douban",
        name: "douban",
        component: () => import("@/views/Douban.vue"),
      },
      {
        path: "/setting",
        name: "setting",
        component: () => import("@/views/Setting.vue"),
      },
      {
        path: "/thanks",
        name: "thanks",
        component: () => import("@/views/Thanks.vue"),
      },
    ],
  },
  {
    path: "/login",
    name: "login",
    component: () => import("@/views/pc/Login.vue"),
  },
];

export default routes;
