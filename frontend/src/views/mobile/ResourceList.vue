<template>
  <div ref="listRef" class="resource-list">
    <!-- 头部刷新区 -->
    <van-cell-group :border="false" class="resource-list__header">
      <van-cell center clickable @click="refreshResources">
        <template #icon>
          <van-icon name="replay" class="header__icon" />
        </template>
        <template #title>
          <div class="header__content">
            <span class="content__title">最新资源</span>
            <span class="content__tip">(点击可获取最新资源)</span>
          </div>
        </template>
        <template #label>
          <span class="header__time">上次刷新：{{ resourceStore.lastUpdateTime }}</span>
        </template>
      </van-cell>
    </van-cell-group>

    <!-- 资源列表 -->
    <van-tabs
      v-model:active="currentTab"
      swipeable
      animated
      class="resource-list__tabs"
      :border="false"
    >
      <van-tab
        v-for="item in resourceStore.resources"
        :key="item.id"
        :name="item.id"
        :title="item.channelInfo.name"
      >
        <ResourceCard
          :current-channel-id="currentTab"
          @save="handleSave"
          @jump="handleJump"
          @search-moviefor-tag="searchMovieforTag"
        />
      </van-tab>
    </van-tabs>

    <!-- 保存弹窗 -->
    <van-popup
      v-model:show="saveDialogVisible"
      round
      closeable
      position="bottom"
      :style="{ height: '80%', transform: 'translateZ(1px)' }"
      class="save-popup"
    >
      <div class="save-popup__container">
        <!-- 弹窗头部 -->
        <div class="save-popup__header">
          <van-tag :color="getTagColor(currentResource?.cloudType)" round size="medium">
            {{ currentResource?.cloudType }}
          </van-tag>
          <span class="header__title">{{ saveDialogMap[saveDialogStep].title }}</span>
          <span
            v-if="resourceStore.shareInfo.fileSize && saveDialogStep === 1"
            class="header__size"
          >
            {{ formattedFileSize(resourceStore.shareInfo.fileSize) }}
          </span>
        </div>

        <!-- 弹窗内容 -->
        <div class="save-popup__content">
          <van-empty v-if="resourceStore.loadTree && saveDialogStep === 1" class="content__loading">
            <template #image>
              <van-loading size="24px" vertical>加载中...</van-loading>
            </template>
          </van-empty>

          <resource-select
            v-if="saveDialogVisible && saveDialogStep === 1 && resourceStore.resourceSelect.length"
            :cloud-type="currentResource?.cloudType"
          />

          <folder-select
            v-if="saveDialogVisible && saveDialogStep === 2 && currentResource"
            :cloud-type="currentResource.cloudType"
            @select="handleFolderSelect"
            @close="saveDialogVisible = false"
          />
        </div>

        <!-- 弹窗底部 -->
        <div class="save-popup__footer">
          <van-cell class="footer__path" :border="false">
            <template #title>
              <div class="path__label">保存至：</div>
            </template>
            <template #value>
              <div class="path__value">
                <van-icon name="folder-o" class="value__icon" />
                <span
                  class="value__text"
                  :class="{ 'value__text--placeholder': !currentFolderPath }"
                >
                  {{ getCurrentFolderName }}
                </span>
              </div>
            </template>
          </van-cell>

          <van-button
            round
            block
            type="primary"
            size="large"
            :loading="isLoading"
            @click="handleConfirmClick"
          >
            {{ saveDialogMap[saveDialogStep].buttonText }}
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { showToast } from "vant";
import { useResourceStore } from "@/stores/resource";
import { formattedFileSize, throttle } from "@/utils/index";
import type { Folder, ResourceItem } from "@/types";
import FolderSelect from "@/components/mobile/FolderSelect.vue";
import ResourceSelect from "@/components/mobile/ResourceSelect.vue";
import ResourceCard from "@/components/mobile/ResourceCard.vue";

// 状态管理
const router = useRouter();
const resourceStore = useResourceStore();

// 响应式数据
const saveDialogVisible = ref(false);
const currentResource = ref<ResourceItem | null>(null);
const currentFolderId = ref<string | null>(null);
const currentFolderPath = ref<Folder[] | null>(null);
const saveDialogStep = ref<1 | 2>(1);
const currentTab = ref<string>("");
const isLoading = ref(false);
const listRef = ref<HTMLElement | null>(null);

// 计算属性
const getCurrentFolderName = computed(() => {
  return currentFolderPath.value
    ? currentFolderPath.value[currentFolderPath.value.length - 1]?.name
    : "待选择";
});

// 常量定义
const saveDialogMap = {
  1: { title: "选择资源", buttonText: "下一步" },
  2: { title: "选择保存目录", buttonText: "保存" },
};

// 标签颜色映射
const getTagColor = (type?: string) => {
  const colorMap: Record<string, string> = {
    pan115: "#07c160",
    quark: "#1989fa",
  };
  return colorMap[type || ""] || "#ff976a";
};

// 监听器
watch(
  () => resourceStore.resources,
  () => {
    if (resourceStore.resources.length > 0) {
      currentTab.value = resourceStore.resources[0].id;
    }
  }
);

// 方法定义
const refreshResources = () => {
  resourceStore.searchResources("", false);
};

const handleSave = async (resource: ResourceItem) => {
  currentResource.value = resource;
  saveDialogVisible.value = true;
  saveDialogStep.value = 1;

  if (!(await resourceStore.getResourceListAndSelect(resource))) {
    saveDialogVisible.value = false;
  }
};

const handleJump = (resource: ResourceItem) => {
  window.open(resource.cloudLinks[0], "_blank");
};

const handleFolderSelect = (folders: Folder[] | null) => {
  if (!currentResource.value) return;
  currentFolderPath.value = folders;
  currentFolderId.value = folders?.[folders.length - 1]?.cid || "0";
};

const handleConfirmClick = async () => {
  if (saveDialogStep.value === 1) {
    if (!resourceStore.resourceSelect.some((x) => x.isChecked)) {
      showToast("请选择要保存的资源");
      return;
    }
    saveDialogStep.value = 2;
  } else {
    handleSaveBtnClick();
  }
};

const handleSaveBtnClick = async () => {
  if (!currentResource.value || !currentFolderId.value) return;
  saveDialogVisible.value = false;
  await resourceStore.saveResource(currentResource.value, currentFolderId.value);
};

const searchMovieforTag = (tag: string) => {
  router.push({ path: "/resource", query: { keyword: tag } });
};

// 使用节流包装加载更多函数
const throttledLoadMore = throttle((channelId: string) => {
  resourceStore.searchResources("", true, channelId);
}, 2000);

// 滚动加载
const doScroll = () => {
  const appElement = document.querySelector("#app") as HTMLElement;
  if (appElement) {
    const { scrollHeight, scrollTop, clientHeight } = appElement;
    if (scrollHeight - (clientHeight + scrollTop) <= 1) {
      throttledLoadMore(currentTab.value);
    }
  }
};

// 生命周期
onMounted(() => {
  const appElement = document.querySelector("#app");
  if (appElement) {
    appElement.addEventListener("scroll", doScroll);
  }
});

onUnmounted(() => {
  const appElement = document.querySelector("#app");
  if (appElement) {
    appElement.removeEventListener("scroll", doScroll);
  }
});

// 监听标签页切换
watch(currentTab, () => {
  const appElement = document.querySelector("#app");
  if (appElement) {
    appElement.scrollTo(0, 0);
  }
});
// 页面进入 设置缓存的数据源
onMounted(() => {
  const lastResourceList = localStorage.getItem("last_resource_list");
  if (lastResourceList) {
    resourceStore.resources = JSON.parse(lastResourceList).list;
  }
});

// 页面销毁 清除搜索词
onBeforeUnmount(() => {
  resourceStore.keyword = "";
});
</script>

<style lang="scss" scoped>
.resource-list {
  min-height: 100%;
  background: var(--van-background);
  padding-bottom: 20px;

  &__header {
    margin-bottom: 8px;
    background: var(--theme-other_background);

    :deep(.van-cell) {
      padding: 12px 16px;
      min-height: 24px;
    }

    .header__icon {
      font-size: 30px;
      color: var(--theme-theme);
      margin-right: 10px;
      line-height: 1;
    }

    .header__content {
      display: flex;
      align-items: center;
      gap: 6px;

      .content__title {
        font-size: 15px;
        font-weight: 500;
        line-height: 1.4;
      }

      .content__tip {
        font-size: 12px;
        color: var(--van-gray-6);
        background: var(--van-gray-1);
        padding: 2px 6px;
        border-radius: 4px;
        line-height: 1.4;
      }
    }

    .header__time {
      font-size: 12px;
      color: var(--van-gray-6);
      line-height: 1.4;
      margin-top: 2px;
    }
  }

  &__tabs {
    :deep(.van-tabs__wrap) {
      background: var(--theme-other_background);
    }

    :deep(.van-tab) {
      font-size: 14px;
      padding: 0 20px;
      height: 44px;
      line-height: 44px;
    }

    :deep(.van-tabs__line) {
      background: var(--theme-theme);
    }

    :deep(.van-tabs__content) {
      padding: 8px 0;
    }
  }
}

.save-popup {
  &__container {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-bottom: calc(env(safe-area-inset-bottom) + 50px);
  }

  &__header {
    flex-shrink: 0;
    padding: 16px;
    border-bottom: 0.5px solid var(--van-gray-3);
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 40px;

    .header__title {
      font-size: 16px;
      font-weight: 500;
    }

    .header__size {
      margin-left: auto;
      font-size: 13px;
      color: var(--van-gray-6);
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__content {
    flex: 1;
    overflow-y: auto;
    background: var(--van-background-2);

    .content__loading {
      padding: 32px 0;
    }
  }

  &__footer {
    flex-shrink: 0;
    padding: 12px 16px 16px;
    background: var(--theme-other_background);
    border-top: 0.5px solid var(--van-gray-3);
    padding-bottom: calc(16px + env(safe-area-inset-bottom));

    .footer__path {
      margin: 0 0 12px;

      :deep(.van-cell__title) {
        flex: none;
        padding-right: 8px;
        display: flex;
        align-items: center;
      }

      :deep(.van-cell__value) {
        flex: 1;
      }

      .path__label {
        font-size: 14px;
        color: var(--van-text-color);
        font-weight: 500;
        white-space: nowrap;
      }

      .path__value {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        background: var(--van-gray-1);
        border-radius: 4px;
        width: 100%;
        box-sizing: border-box;

        .value__icon {
          font-size: 16px;
          color: var(--theme-theme);
          flex-shrink: 0;
        }

        .value__text {
          font-size: 14px;
          color: var(--van-text-color);
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: left;
          display: block;

          &--placeholder {
            color: var(--van-gray-6);
          }
        }
      }
    }

    :deep(.van-cell__value) {
      flex: 1;
      text-align: left;
    }

    .van-button {
      height: 44px;
      font-size: 16px;
      font-weight: 500;
    }
  }

  :deep(.van-popup) {
    z-index: 2001 !important;
  }
}

// 全局样式优化
:deep(.van-cell) {
  padding: 16px 20px;

  &::after {
    display: none;
  }
}

:deep(.van-popup) {
  max-height: 90vh;
}

:deep(.van-overlay) {
  background-color: rgba(0, 0, 0, 0.7);
}
</style>
