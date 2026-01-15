<template>
  <div class="home">
    <!-- 顶部搜索栏 -->
    <header class="home__header">
      <div class="header__wrapper">
        <van-search
          v-model="searchForm.keyword"
          class="header__search"
          shape="round"
          placeholder="请输入搜索关键词或输入链接直接解析"
          @search="handleSearch"
        />

        <van-icon
          name="https://b.yzcdn.cn/vant/icon-demo-1126.png"
          class="header__action"
          @click="handleLogout"
        />
      </div>
    </header>

    <!-- 主要内容区 -->
    <main class="home__content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- 底部导航栏 -->
    <van-tabbar class="home__tabbar" route>
      <van-tabbar-item to="/resource" icon="search">搜索</van-tabbar-item>
      <van-tabbar-item to="/douban" icon="video">热门</van-tabbar-item>
      <van-tabbar-item to="/setting" icon="setting-o">设置</van-tabbar-item>
    </van-tabbar>

    <!-- 全局加载状态 -->
    <van-overlay :show="resourceStore.loading" class="home__loading" @touchmove.prevent>
      <van-loading type="spinner" color="#fff" size="24px"> 资源搜索中... </van-loading>
    </van-overlay>

    <!-- 返回顶部 -->
    <van-back-top right="30px" bottom="100px" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { showConfirmDialog } from "vant";
import { useResourceStore } from "@/stores/resource";
import { useUserSettingStore } from "@/stores/userSetting";

// 接口定义
interface SearchForm {
  keyword: string;
}

// 状态管理
const resourceStore = useResourceStore();
const settingStore = useUserSettingStore();

// 响应式数据
const searchForm = ref<SearchForm>({
  keyword: "",
});

// 路由相关
const router = useRouter();
const route = useRoute();

// 初始化
settingStore.getSettings();

// 监听路由参数
watch(
  () => route.query.keyword as string,
  (keyword) => {
    if (keyword) {
      searchForm.value.keyword = keyword;
      handleSearch();
    } else {
      searchForm.value.keyword = resourceStore.keyword;
    }
  }
);
watch(
  () => resourceStore.keyword,
  (newKeyword) => {
    searchForm.value.keyword = newKeyword;
  }
);

// 方法定义
const handleSearch = async () => {
  const keyword = searchForm.value.keyword.trim();
  if (!keyword) return;

  if (keyword.startsWith("http")) {
    await resourceStore.parsingCloudLink(keyword);
    return;
  }

  if (route.path !== "/resource") {
    await router.push("/resource");
  }
  await resourceStore.searchResources(keyword);
};

const handleLogout = () => {
  showConfirmDialog({
    title: "退出登录",
    message: "确定要退出登录吗？",
  }).then(() => {
    localStorage.removeItem("token");
    router.push("/login");
  });
};
</script>

<style lang="scss" scoped>
.home {
  // 布局
  min-height: 100vh;
  background: var(--theme-background);
  display: flex;
  flex-direction: column;

  // 头部搜索
  &__header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background: var(--theme-other_background);
    backdrop-filter: blur(8px);
    box-shadow: 0 1px 8px rgba(0, 0, 0, 0.05);

    .header__wrapper {
      display: flex;
      align-items: center;
      padding: 8px;
    }

    .header__search {
      flex: 1;
      padding: 0;
      background: transparent;
    }

    .header__action {
      padding: 8px;
      margin-left: 4px;
      color: var(--theme-color);
      font-size: 24px;
      cursor: pointer;
      line-height: 1;

      &:active {
        color: var(--theme-theme);
      }
    }
  }

  // 主内容区 - 调整顶部间距
  &__content {
    padding-top: 64px; // 搜索框高度(48px) + 上下padding(8px * 2)
    padding-bottom: 100px; // tabbar高度 + 底部安全区域
    box-sizing: border-box;
    flex: 1;
  }

  // 加载状态
  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #fff;
  }
}

// 过渡动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// 深度修改 Vant 组件样式
:deep(.van-tabbar) {
  background: var(--theme-other_background);
  backdrop-filter: blur(8px);
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

:deep(.van-tabbar-item) {
  color: var(--theme-color);
}

:deep(.van-tabbar-item--active) {
  color: var(--theme-theme);
}
</style>
