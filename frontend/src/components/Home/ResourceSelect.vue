<template>
  <div class="resource-select">
    <div class="select-header">
      <div class="select-info">
        <el-icon><Document /></el-icon>
        <span>已选择 {{ selectedCount }} 个文件</span>
        <span v-if="totalSize" class="total-size">({{ formattedFileSize(totalSize) }})</span>
      </div>
      <div class="header-actions">
        <el-button type="text" @click="handleSelectAll(!hasSelectedAll)">
          {{ hasSelectedAll ? "取消全选" : "全选" }}
        </el-button>
      </div>
    </div>

    <div class="file-list">
      <div
        v-for="file in resourceStore.shareInfo.list"
        :key="file.fileId"
        class="file-item"
        :class="{ 'is-checked': isChecked(file.fileId) }"
        @click="toggleSelect(file)"
      >
        <el-checkbox :model-value="isChecked(file.fileId)" @click.stop>
          <div class="file-info">
            <el-icon><Document /></el-icon>
            <span class="file-name">{{ file.fileName }}</span>
            <span v-if="file.fileSize" class="file-size">
              {{ formattedFileSize(file.fileSize) }}
            </span>
          </div>
        </el-checkbox>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResourceStore } from "@/stores/resource";
import { formattedFileSize } from "@/utils/index";
import { computed } from "vue";
import type { ShareInfo } from "@/types";
import { Document } from "@element-plus/icons-vue";

const resourceStore = useResourceStore();

const selectedCount = computed(
  () => resourceStore.resourceSelect.filter((x) => x.isChecked).length
);

const totalSize = computed(() =>
  resourceStore.resourceSelect
    .filter((x) => x.isChecked)
    .reduce((sum, item) => sum + (item.fileSize || 0), 0)
);

const totalFiles = computed(() => resourceStore.shareInfo.list.length);

const hasSelectedAll = computed(() => selectedCount.value === totalFiles.value);

const isChecked = (fileId: string) => {
  return resourceStore.resourceSelect.find((x) => x.fileId === fileId)?.isChecked;
};

const toggleSelect = (file: ShareInfo) => {
  let resourceSelect = [...resourceStore.resourceSelect];
  const item = resourceSelect.find((x) => x.fileId === file.fileId);
  if (item) {
    item.isChecked = !item.isChecked;
    resourceStore.setSelectedResource(resourceSelect);
  }
};

const handleSelectAll = (checked: boolean) => {
  const resourceSelect = resourceStore.shareInfo.list.map((file) => ({
    fileId: file.fileId,
    fileName: file.fileName,
    fileSize: file.fileSize,
    isChecked: checked,
  }));
  resourceStore.setSelectedResource(resourceSelect);
};
</script>

<style lang="scss" scoped>
@import "@/styles/responsive.scss";

.resource-select {
  min-height: 200px;
  max-height: 500px;
  display: flex;
  flex-direction: column;
  gap: 16px;

  .select-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--el-fill-color-light);
    border-radius: var(--theme-radius);

    .select-info {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--theme-text-regular);
      font-size: 14px;

      .el-icon {
        font-size: 16px;
      }

      .total-size {
        color: var(--theme-text-secondary);
      }
    }

    .header-actions {
      display: flex;
      gap: 16px;
    }

    .el-button {
      font-size: 13px;
      padding: 4px 8px;

      &:not(:disabled):hover {
        color: var(--theme-primary);
      }
    }
  }

  .file-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;

    .file-item {
      padding: 12px 16px;
      border-radius: var(--theme-radius);
      cursor: pointer;
      transition: var(--theme-transition);

      &:hover {
        background: var(--el-fill-color-light);
      }

      &.is-checked {
        background: var(--el-color-primary-light-9);
      }

      .file-info {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--theme-text-primary);
        font-size: 14px;

        .el-icon {
          font-size: 16px;
          color: var(--theme-text-regular);
        }

        .file-name {
          flex: 1;
          @include text-ellipsis;
        }

        .file-size {
          color: var(--theme-text-secondary);
          font-size: 13px;
        }
      }
    }
  }
}
</style>
