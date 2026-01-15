<template>
  <div class="folder-select">
    <div class="folder-header">
      <div class="folder-path">
        <el-icon><FolderOpened /></el-icon>
        <template v-if="folderPath.length">
          <span
            v-for="(folder, index) in folderPath"
            :key="folder.cid"
            class="path-item"
            @click="handlePathClick(index)"
          >
            <span class="folder-name">{{ folder.name }}</span>
            <el-icon v-if="index < folderPath.length - 1"><ArrowRight /></el-icon>
          </span>
        </template>
        <span v-else class="root-path" @click="handlePathClick(-1)">根目录</span>
      </div>
    </div>

    <div class="folder-list">
      <div v-if="!folders.length" class="empty-folder">
        <el-empty description="暂无文件夹" />
      </div>
      <div
        v-for="folder in folders"
        :key="folder.cid"
        class="folder-item"
        :class="{ 'is-selected': folder.cid === selectedFolder?.cid }"
        @click="handleFolderClick(folder)"
      >
        <div class="folder-info">
          <el-icon><Folder /></el-icon>
          <span class="folder-name">{{ folder.name }}</span>
        </div>
        <el-icon class="arrow-icon"><ArrowRight /></el-icon>
      </div>
    </div>

    <div v-if="loading" class="loading-overlay">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps } from "vue";
import { cloud115Api } from "@/api/cloud115";
import { quarkApi } from "@/api/quark";
import type { Folder as FolderType } from "@/types";
import { Folder, FolderOpened, ArrowRight, Loading } from "@element-plus/icons-vue";

import { ElMessage } from "element-plus";

const props = defineProps({
  cloudType: {
    type: String,
    required: true,
  },
});

const loading = ref(false);
const folders = ref<FolderType[]>([]);
const selectedFolder = ref<FolderType | null>(null);
const folderPath = ref<FolderType[]>([{ name: "根目录", cid: "0" }]);
const emit = defineEmits<{
  (e: "select", folderId: string): void;
  (e: "close"): void;
}>();

const cloudTypeApiMap = {
  pan115: cloud115Api,
  quark: quarkApi,
};

const getList = async (cid: string = "0") => {
  const api = cloudTypeApiMap[props.cloudType as keyof typeof cloudTypeApiMap];
  loading.value = true;
  try {
    const res = await api.getFolderList?.(cid);
    if (res?.code === 0) {
      folders.value = res.data || [];
    } else {
      throw new Error(res?.message);
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "获取目录失败");
    emit("close");
  } finally {
    loading.value = false;
  }
};

const handleFolderClick = async (folder: FolderType) => {
  selectedFolder.value = folder;
  folderPath.value = [...folderPath.value, folder];
  emit("select", folder.cid);
  await getList(folder.cid);
};

const handlePathClick = async (index: number) => {
  if (index < 0) {
    // 点击根目录
    folderPath.value = [{ name: "根目录", cid: "0" }];
    selectedFolder.value = null;
    await getList("0");
  } else {
    // 点击路径中的某个文件夹
    const targetFolder = folderPath.value[index];
    folderPath.value = folderPath.value.slice(0, index + 1);
    selectedFolder.value = targetFolder;
    await getList(targetFolder.cid);
    emit("select", targetFolder.cid);
  }
};

// 初始化加载
getList();
</script>

<style lang="scss" scoped>
@import "@/styles/common.scss";

.folder-select {
  position: relative;
  min-height: 300px;
  max-height: 500px;
  display: flex;
  flex-direction: column;
  padding: 4px;

  .folder-header {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: var(--el-fill-color-light);
    border-radius: var(--theme-radius);

    .folder-path {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--theme-text-regular);
      font-size: 14px;
      overflow-x: auto;

      &::-webkit-scrollbar {
        height: 4px;
      }

      &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 2px;
      }

      .el-icon {
        flex-shrink: 0;
        font-size: 16px;
        color: var(--theme-primary);
      }

      .path-item {
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        cursor: pointer;
        transition: var(--theme-transition);

        &:hover {
          color: var(--theme-primary);

          .folder-name {
            color: var(--theme-primary);
          }
        }

        .folder-name {
          color: var(--theme-text-primary);
        }
      }

      .root-path {
        color: var(--theme-text-secondary);
        cursor: pointer;
        transition: var(--theme-transition);

        &:hover {
          color: var(--theme-primary);
        }
      }
    }
  }
}

.folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;

  .folder-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-radius: var(--theme-radius);
    cursor: pointer;
    transition: var(--theme-transition);

    &:hover {
      background: var(--el-fill-color-light);
    }

    &.is-selected {
      background: var(--el-color-primary-light-9);
      color: var(--theme-primary);

      .el-icon {
        color: var(--theme-primary);
      }
    }

    .folder-info {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;

      .el-icon {
        font-size: 16px;
        color: var(--theme-text-regular);
      }

      .folder-name {
        color: var(--theme-text-primary);
      }
    }

    .arrow-icon {
      font-size: 16px;
      color: var(--theme-text-secondary);
    }
  }
}

.empty-folder {
  padding: 32px 0;
}

.loading-overlay {
  @include flex-center;
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(4px);
  gap: 8px;
  font-size: 14px;
  color: var(--theme-text-regular);

  .loading-icon {
    font-size: 20px;
    animation: rotating 2s linear infinite;
  }
}

@keyframes rotating {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
