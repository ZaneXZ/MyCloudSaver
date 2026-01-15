<template>
  <div class="folder-select">
    <!-- 面包屑导航 -->
    <div class="folder-select__nav">
      <van-cell :border="false" class="nav-cell">
        <template #title>
          <div class="nav-breadcrumb">
            <van-icon name="wap-home-o" class="home-icon" @click="handleHomeClick" />
            <template v-for="(path, index) in currentFolderPath" :key="path.cid">
              <van-icon v-if="index !== 0" name="arrow" />
              <span
                class="path-item"
                :class="{ 'is-active': index === currentFolderPath.length - 1 }"
                @click="handleFolderClick(path, index)"
              >
                {{ path.name }}
              </span>
            </template>
          </div>
        </template>
      </van-cell>
    </div>

    <!-- 文件夹列表 -->
    <div class="folder-select__list">
      <div v-if="resourceStore.loadTree" class="folder-select__loading">
        <van-loading type="spinner" vertical>加载中...</van-loading>
      </div>
      <van-empty v-if="!resourceStore.loadTree && !folders.length" description="暂无文件夹" />
      <van-cell-group v-if="!resourceStore.loadTree && folders.length" :border="false">
        <van-cell
          v-for="folder in folders"
          :key="folder.cid"
          :border="false"
          clickable
          @click="getList(folder)"
        >
          <template #icon>
            <van-icon name="folder-o" class="folder-icon" />
          </template>
          <template #title>
            <span class="folder-name">{{ folder.name }}</span>
          </template>
          <template #right-icon>
            <van-icon name="arrow" />
          </template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps, onBeforeUnmount } from "vue";
import { cloud115Api } from "@/api/cloud115";
import { quarkApi } from "@/api/quark";
import type { Folder } from "@/types";
import { type RequestResult } from "@/types/response";
import { useResourceStore } from "@/stores/resource";
import { showNotify } from "vant";

const props = defineProps({
  cloudType: {
    type: String,
    required: true,
  },
});

const resourceStore = useResourceStore();
const folders = ref<Folder[]>([]);
const currentFolderPath = ref<Folder[]>([]);

const emit = defineEmits<{
  (e: "select", currentFolderPath: Folder[] | null): void;
  (e: "close"): void;
}>();

const cloudTypeApiMap = {
  pan115: cloud115Api,
  quark: quarkApi,
};

// 返回根目录
const handleHomeClick = () => {
  currentFolderPath.value = [];
  getList();
};

const handleFolderClick = (folder: Folder, index: number) => {
  currentFolderPath.value = currentFolderPath.value.slice(0, index + 1);
  getList(folder);
};

const getList = async (data?: Folder) => {
  const api = cloudTypeApiMap[props.cloudType as keyof typeof cloudTypeApiMap];
  try {
    resourceStore.setLoadTree(true);
    const res: RequestResult<Folder[]> = await api.getFolderList?.(data?.cid || "0");

    if (res?.code === 0) {
      folders.value = res.data || [];
      if (!data) {
        currentFolderPath.value = [
          {
            name: "根目录",
            cid: "0",
          },
        ];
      } else if (!currentFolderPath.value.find((p) => p.cid === data.cid)) {
        currentFolderPath.value.push(data);
      }
      emit("select", currentFolderPath.value);
    } else {
      throw new Error(res.message);
    }
  } catch (error) {
    showNotify({
      type: "danger",
      message: error instanceof Error ? error.message : "获取目录失败",
    });
    currentFolderPath.value = [];
    folders.value = [];
    emit("select", null);
    emit("close");
  } finally {
    resourceStore.setLoadTree(false);
  }
};

// 初始化加载
getList();

// 组件销毁前重置状态
onBeforeUnmount(() => {
  currentFolderPath.value = [];
  folders.value = [];
  emit("select", null);
});
</script>

<style lang="scss" scoped>
.folder-select {
  position: relative;
  height: 100%;
  background: var(--theme-other_background);
  display: flex;
  flex-direction: column;

  &__nav {
    flex-shrink: 0;
    border-bottom: 0.5px solid #f5f5f5;
    background: var(--theme-other_background);

    .nav-cell {
      padding: 12px 16px;
      min-height: 24px;
    }

    .nav-breadcrumb {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      font-size: 14px;
      line-height: 1.4;
      min-height: 20px;
    }

    .home-icon {
      font-size: 16px;
      color: var(--theme-theme);
      margin-right: 4px;
    }

    .path-item {
      color: #666;
      padding: 2px 4px;
      border-radius: 4px;

      &.is-active {
        color: var(--theme-theme);
        font-weight: 500;
      }

      &:active {
        background-color: #f5f5f5;
      }
    }
  }

  &__list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    position: relative;
    min-height: 200px;
    display: flex;
    flex-direction: column;

    .van-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .van-cell-group {
      flex: 1;
    }
  }

  &__loading {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.9);
    z-index: 0;

    .van-loading {
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.7);
      border-radius: 8px;
      color: #fff;
    }
  }

  .folder-icon {
    font-size: 20px;
    color: var(--theme-theme);
    margin-right: 8px;
  }

  .folder-name {
    font-size: 15px;
    color: var(--theme-color);
  }
}

// 深度修改 Vant 组件样式
:deep(.van-cell) {
  padding: 12px 16px;

  &::after {
    display: none;
  }

  &:active {
    background-color: #f5f5f5;
  }
}

:deep(.van-empty) {
  padding: 32px 0;
  margin: 0;
}
</style>
