<template>
  <div class="pc-search">
    <!-- 搜索区域 -->
    <div class="pc-search__input">
      <el-input
        v-model="keyword"
        placeholder="请输入搜索关键词或输入链接直接解析"
        clearable
        @keyup.enter="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
        <template #suffix>
          <el-icon v-if="keyword" class="search-icon" @click="handleSearch">
            <ArrowRight />
          </el-icon>
        </template>
      </el-input>
    </div>

    <!-- 用户操作区 -->
    <div class="pc-search__actions">
      <el-tooltip effect="dark" content="退出登录" placement="bottom">
        <el-button class="logout-btn" type="text" @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useResourceStore } from "@/stores/resource";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Search, ArrowRight, SwitchButton } from "@element-plus/icons-vue";
import { STORAGE_KEYS } from "@/constants/storage";

// 路由相关
const route = useRoute();
const router = useRouter();
const resourcStore = useResourceStore();

// 响应式数据
const keyword = ref("");
const routeKeyword = computed(() => route.query.keyword as string);

// 退出登录
const handleLogout = () => {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  router.push("/login");
  ElMessage.success("已退出登录");
};

// 搜索处理
const handleSearch = async () => {
  const searchText = keyword.value.trim();
  if (!searchText) {
    ElMessage.warning("请输入搜索内容");
    return;
  }

  // 链接解析处理
  if (searchText.startsWith("http")) {
    await resourcStore.parsingCloudLink(searchText);
    return;
  }

  // 关键词搜索
  await resourcStore.searchResources(searchText);
  if (route.path !== "/resource") {
    router.push("/resource");
  }
};

// 监听路由参数变化
watch(
  () => routeKeyword.value,
  (newKeyword) => {
    if (newKeyword) {
      keyword.value = newKeyword;
      handleSearch();
    } else {
      keyword.value = resourcStore.keyword;
    }
  }
);
watch(
  () => resourcStore.keyword,
  (newKeyword) => {
    keyword.value = newKeyword;
  }
);
</script>

<style lang="scss" scoped>
@import "@/styles/common.scss";

.pc-search {
  @include flex-center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;

  // 搜索输入区域
  &__input {
    flex: 1;
    min-width: 0; // 防止溢出

    :deep(.el-input) {
      --el-input-height: 44px;

      .el-input__wrapper {
        @include glass-effect;
        padding: 0 16px;
        border-radius: var(--theme-radius);
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.1),
          0 2px 4px rgba(0, 0, 0, 0.05),
          0 1px 2px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(0, 0, 0, 0.08);
        transition: var(--theme-transition);
        background: rgba(255, 255, 255, 0.9);

        &:hover {
          border-color: var(--theme-primary);
          box-shadow:
            inset 0 0 0 1px var(--theme-primary),
            0 4px 8px rgba(0, 0, 0, 0.1);
        }

        &.is-focus {
          border-color: var(--theme-primary);
          box-shadow:
            inset 0 0 0 1px var(--theme-primary),
            0 4px 8px rgba(0, 0, 0, 0.1),
            0 0 0 3px rgba(0, 102, 204, 0.1);
          background: #fff;
        }
      }

      .el-input__inner {
        font-size: 15px;
        color: var(--theme-text-primary);
        height: 42px;
        line-height: 42px;

        &::placeholder {
          color: var(--theme-text-secondary);
        }
      }

      .el-input__prefix-inner {
        .el-icon {
          font-size: 18px;
          color: var(--theme-text-secondary);
          margin-right: 8px;
        }
      }

      .search-icon {
        font-size: 18px;
        cursor: pointer;
        color: var(--theme-primary);
        transition: var(--theme-transition);
        margin-left: 8px;

        &:hover {
          transform: scale(1.1);
        }
      }
    }
  }

  // 操作区域
  &__actions {
    .logout-btn {
      @include glass-effect;
      width: 44px;
      height: 44px;
      padding: 0;
      border-radius: var(--theme-radius);
      transition: var(--theme-transition);

      .el-icon {
        font-size: 20px;
        color: var(--theme-text-regular);
        transition: var(--theme-transition);
      }

      &:hover {
        background: var(--theme-primary);
        transform: translateY(-2px);
        box-shadow: var(--theme-shadow-sm);

        .el-icon {
          color: #fff;
        }
      }
    }
  }
}
</style>
