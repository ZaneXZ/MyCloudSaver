<template>
  <div class="pc-resources">
    <!-- 头部工具栏 -->
    <div class="pc-resources__header">
      <div class="header__left">
        <el-tooltip effect="dark" content="点击获取最新资源" placement="bottom">
          <el-button class="refresh-btn" type="text" @click="refreshResources">
            <el-icon><Refresh /></el-icon>
            <span>最新资源</span>
            <span class="update-time"> (上次刷新时间：{{ resourceStore.lastUpdateTime }}) </span>
          </el-button>
        </el-tooltip>
      </div>

      <div class="header__right">
        <el-tooltip
          effect="dark"
          :content="
            userStore.imagesSource === 'local' ? '图片切换到代理模式' : '图片切换到直连模式'
          "
          placement="bottom"
        >
          <el-button
            type="text"
            class="view-toggle"
            @click="
              userStore.setImagesSource(userStore.imagesSource === 'proxy' ? 'local' : 'proxy')
            "
          >
            <el-icon>
              <component :is="userStore.imagesSource === 'proxy' ? 'Guide' : 'Location'" />
            </el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip
          effect="dark"
          :content="userStore.displayStyle === 'card' ? '切换到列表视图' : '切换到卡片视图'"
          placement="bottom"
        >
          <el-button
            type="text"
            class="view-toggle"
            @click="setDisplayStyle(userStore.displayStyle === 'card' ? 'table' : 'card')"
          >
            <el-icon>
              <component :is="userStore.displayStyle === 'card' ? 'Menu' : 'Grid'" />
            </el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 资源列表 -->
    <div id="pc-resources-content" ref="contentRef" class="pc-resources__content">
      <component
        :is="userStore.displayStyle === 'table' ? ResourceTable : ResourceCard"
        v-if="resourceStore.resources.length > 0"
        @load-more="handleLoadMore"
        @jump="handleJump"
        @search-moviefor-tag="searchMovieforTag"
        @save="handleSave"
      />

      <!-- 空状态 -->
      <div v-if="resourceStore.resources.length === 0" class="pc-resources__empty">
        <el-empty :image-size="200">
          <template #description>
            <p class="empty-text">暂无资源</p>
            <el-tooltip effect="dark" content="点击获取最新资源" placement="top">
              <el-button type="primary" @click="refreshResources">
                <el-icon><Refresh /></el-icon>
                <span>刷新资源</span>
              </el-button>
            </el-tooltip>
          </template>
        </el-empty>
      </div>
    </div>

    <!-- 返回顶部 -->
    <el-backtop :bottom="40" :right="40" target=".pc-resources__content">
      <div class="pc-resources__backtop">
        <el-icon><ArrowUp /></el-icon>
      </div>
    </el-backtop>

    <!-- 保存对话框 -->
    <el-dialog
      v-if="currentResource"
      v-model="saveDialogVisible"
      :title="saveDialogMap[saveDialogStep].title"
      width="580px"
      destroy-on-close
    >
      <template #header="{ titleId }">
        <div class="dialog-header">
          <h3 :id="titleId">
            <div class="title-main">
              <el-tag
                :type="resourceStore.tagColor[currentResource.cloudType as keyof TagColor]"
                effect="dark"
                round
              >
                {{ currentResource.cloudType }}
              </el-tag>
              {{ saveDialogMap[saveDialogStep].title }}
            </div>
            <div class="title-sub">
              <span class="resource-title" :title="currentResource.title">
                {{ currentResource.title }}
              </span>
              <span
                v-if="resourceStore.shareInfo.fileSize && saveDialogStep === 1"
                class="file-size"
              >
                ({{ formattedFileSize(resourceStore.shareInfo.fileSize) }})
              </span>
            </div>
          </h3>
        </div>
      </template>

      <div v-loading="resourceStore.loadTree">
        <resource-select
          v-if="saveDialogVisible && saveDialogStep === 1 && resourceStore.resourceSelect.length"
          :cloud-type="currentResource.cloudType"
        />
        <folder-select
          v-if="saveDialogVisible && saveDialogStep === 2"
          :cloud-type="currentResource.cloudType"
          @select="handleFolderSelect"
          @close="saveDialogVisible = false"
        />
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="saveDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleConfirmClick">
            {{ saveDialogMap[saveDialogStep].buttonText }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 加载状态 -->
    <div v-if="resourceStore.loading" class="pc-resources__loading">
      <div class="loading-text">加载中...</div>
      <div class="is-loading">
        <el-icon><Loading /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useResourceStore } from "@/stores/resource";
import { useUserSettingStore } from "@/stores/userSetting";
import FolderSelect from "@/components/Home/FolderSelect.vue";
import ResourceSelect from "@/components/Home/ResourceSelect.vue";
import ResourceTable from "@/components/Home/ResourceTable.vue";
import { formattedFileSize } from "@/utils/index";
import type { ResourceItem, TagColor } from "@/types";
import { onMounted, onBeforeUnmount } from "vue";
import ResourceCard from "@/components/Home/ResourceCard.vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowUp } from "@element-plus/icons-vue";
const router = useRouter();

const resourceStore = useResourceStore();
const userStore = useUserSettingStore();
const saveDialogVisible = ref(false);
const currentResource = ref<ResourceItem | null>(null);
const currentFolderId = ref<string | null>(null);
const saveDialogStep = ref<1 | 2>(1);

const refreshResources = async () => {
  resourceStore.searchResources("", false);
};

const saveDialogMap = {
  1: {
    title: "选择资源",
    buttonText: "下一步",
  },
  2: {
    title: "选择保存目录",
    buttonText: "保存到此目录",
  },
};

const handleSave = async (resource: ResourceItem) => {
  currentResource.value = resource;
  saveDialogVisible.value = true;
  saveDialogStep.value = 1;
  if (!(await resourceStore.getResourceListAndSelect(currentResource.value))) {
    saveDialogVisible.value = false;
  }
};

const handleFolderSelect = async (folderId: string) => {
  if (!currentResource.value) return;
  currentFolderId.value = folderId;
};

const handleConfirmClick = async () => {
  if (saveDialogStep.value === 1) {
    const selectedFiles = resourceStore.resourceSelect.filter((x) => x.isChecked);
    if (selectedFiles.length === 0) {
      ElMessage.warning("请选择要保存的资源");
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
const setDisplayStyle = (style: string) => {
  userStore.setDisplayStyle(style as "card" | "table");
};
// 添加加载更多处理函数
const handleLoadMore = (channelId: string) => {
  resourceStore.searchResources("", true, channelId);
};

const handleJump = (resource: ResourceItem) => {
  window.open(resource.cloudLinks[0], "_blank");
};

const searchMovieforTag = (tag: string) => {
  router.push({ path: "/resource", query: { keyword: tag } });
};
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
@import "@/styles/common.scss";
@import "@/styles/responsive.scss";

.pc-resources {
  // 整体容器
  position: relative;
  width: 100%;

  // 头部工具栏
  &__header {
    @include glass-effect;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    padding: 0 20px;
    margin-bottom: 16px;
    border-radius: var(--theme-radius);
    border: 1px solid rgba(0, 0, 0, 0.08);
    transition: var(--theme-transition);

    &:hover {
      border-color: var(--theme-primary);
      box-shadow: var(--theme-shadow-sm);
    }

    .header__left {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding: 8px 0;

      .refresh-btn {
        @include flex-center;
        gap: 8px;
        color: var(--theme-text-regular);
        transition: var(--theme-transition);
        white-space: nowrap;

        .el-icon {
          font-size: 18px;
          color: var(--theme-primary);
        }

        .update-time {
          margin-left: 4px;
          font-size: 13px;
          color: var(--theme-text-secondary);
          white-space: nowrap;
        }

        &:hover {
          color: var(--theme-primary);
          transform: translateY(-1px);
        }
      }
    }

    .header__right {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;

      .view-toggle {
        width: 36px;
        height: 36px;
        padding: 0;
        color: var(--theme-text-regular);
        border-radius: var(--theme-radius);
        transition: var(--theme-transition);

        .el-icon {
          font-size: 18px;
        }

        &:hover {
          color: var(--theme-primary);
          background: rgba(0, 102, 204, 0.05);
          transform: translateY(-1px);
        }
      }
    }
  }

  // 内容区域
  &__content {
    position: relative;
    width: 100%;
    height: calc(100vh - 180px);
    overflow-y: auto;

    // 资源列表组件样式覆盖
    :deep(.resource-table),
    :deep(.resource-card) {
      height: 100%;

      // 自定义滚动条
      &::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;

        &:hover {
          background: rgba(0, 0, 0, 0.3);
        }
      }

      &::-webkit-scrollbar-track {
        background: transparent;
      }
    }
  }

  // 加载状态
  &__loading {
    @include glass-effect;
    @include flex-center;
    position: fixed;
    inset: 0;
    z-index: 2000;
    flex-direction: column;
    gap: 16px;
    background: rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: fadeIn 0.3s ease;

    .loading-text {
      color: var(--theme-text-primary);
      font-size: 14px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .is-loading {
      font-size: 24px;
      color: var(--theme-primary);
      animation: rotating 2s linear infinite;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
    }
  }

  // 空状态
  &__empty {
    @include flex-center;
    flex-direction: column;
    gap: 16px;
    height: 100%;

    .empty-text {
      color: var(--theme-text-primary);
      font-size: 14px;
      margin: 8px 0 16px;
    }

    .el-button {
      @include flex-center;
      gap: 8px;
      padding: 8px 20px;
      height: 40px;
      font-size: 14px;
      transition: var(--theme-transition);
      background: var(--theme-primary);
      border-color: var(--theme-primary);

      .el-icon {
        font-size: 16px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--theme-shadow-sm);
      }
    }
  }

  // 返回顶部按钮
  &__backtop {
    @include flex-center;
    width: 40px;
    height: 40px;
    color: var(--theme-primary);
    background: var(--theme-card-bg);
    border-radius: var(--theme-radius);
    box-shadow: var(--theme-shadow);
    transition: var(--theme-transition);

    &:hover {
      background: var(--theme-primary);
      color: #fff;
      transform: translateY(-2px);
    }

    .el-icon {
      font-size: 20px;
    }
  }
}

// 对话框样式
.dialog-header {
  h3 {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    font-weight: 600;
    color: var(--theme-text-primary);

    .title-main {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
    }

    .title-sub {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--theme-text-secondary);
      font-weight: normal;
    }

    .resource-title {
      max-width: 300px;
      @include text-ellipsis;
    }
  }

  .file-size {
    color: var(--theme-text-secondary);
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
}

:deep(.el-dialog) {
  border-radius: var(--theme-radius);
  overflow: hidden;

  .el-dialog__header {
    margin: 0;
    padding: 20px 24px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .el-dialog__body {
    padding: 24px;
  }

  .el-dialog__footer {
    padding: 16px 24px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}

// 表格扩展列样式
:deep(.el-table) {
  .el-table__expand-column {
    .cell {
      padding: 0;
    }
  }

  .el-table__expanded-cell {
    padding: 20px;
  }

  .el-table__expand-icon {
    height: 23px;
    line-height: 23px;
  }
}

// 加载动画
@keyframes fadeIn {
  from {
    opacity: 0;
    backdrop-filter: blur(0);
  }
  to {
    opacity: 1;
    backdrop-filter: blur(8px);
  }
}
</style>
