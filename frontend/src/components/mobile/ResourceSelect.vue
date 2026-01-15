<template>
  <div class="resource-select">
    <van-checkbox-group v-model="selectedResourceIds">
      <van-cell-group :border="false">
        <van-cell
          v-for="item in resourceStore.shareInfo.list"
          :key="item.fileId"
          class="resource-item"
          :border="false"
          center
          @click="handleItemClick(item.fileId)"
        >
          <template #title>
            <div class="resource-item__content">
              <van-icon name="folder-o" class="content__icon" />
              <div class="content__info">
                <span class="info__name">{{ item.fileName }}</span>
                <span v-if="item.fileSize" class="info__size">
                  {{ formattedFileSize(item.fileSize) }}
                </span>
              </div>
            </div>
          </template>
          <template #right-icon>
            <van-checkbox
              :name="item.fileId"
              class="resource-item__checkbox"
              @click.stop="handleItemClick(item.fileId)"
            />
          </template>
        </van-cell>
      </van-cell-group>
    </van-checkbox-group>

    <!-- 空状态 -->
    <van-empty v-if="!resourceStore.shareInfo.list?.length" description="暂无可选资源" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useResourceStore } from "@/stores/resource";
import { formattedFileSize } from "@/utils/index";

const resourceStore = useResourceStore();
const selectedResourceIds = ref<string[]>([]);

// 初始化选中状态
selectedResourceIds.value = resourceStore.resourceSelect
  .filter((x) => x.isChecked)
  .map((x) => x.fileId);

// 监听选中状态变化
watch(selectedResourceIds, (newIds) => {
  const newResourceSelect = [...resourceStore.resourceSelect];
  newResourceSelect.forEach((x) => {
    x.isChecked = newIds.includes(x.fileId);
  });
  resourceStore.setSelectedResource(newResourceSelect);
});

// 添加点击处理函数
const handleItemClick = (fileId: string) => {
  const index = selectedResourceIds.value.indexOf(fileId);
  if (index === -1) {
    selectedResourceIds.value.push(fileId);
  } else {
    selectedResourceIds.value.splice(index, 1);
  }
};
</script>

<style lang="scss" scoped>
// 工具类
@mixin text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-select {
  height: 100%;
  background: var(--theme-other_background);
  width: 100%;
  overflow-x: hidden;

  .resource-item {
    position: relative;

    &__content {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 0;
      margin-right: 40px;

      .content__icon {
        flex-shrink: 0;
        font-size: 20px;
        color: var(--theme-theme);
        margin-top: 2px;
      }

      .content__info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;

        .info__name {
          font-size: 15px;
          line-height: 1.4;
          color: var(--van-text-color);
          word-break: break-all;
          white-space: normal;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .info__size {
          font-size: 13px;
          color: var(--van-gray-6);
          @include text-ellipsis;
        }
      }
    }

    &__checkbox {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);

      :deep(.van-checkbox__icon) {
        font-size: 18px;
        cursor: pointer;

        .van-icon {
          border-radius: 2px;
          transition: all 0.2s;
        }
      }
    }

    &:active {
      background-color: var(--van-active-color);
    }
  }
}

// 深度修改 Vant 组件样式
:deep(.van-cell) {
  align-items: flex-start;
  padding: 0 16px;
  width: 100%;
  box-sizing: border-box;
  min-height: 60px;
  position: relative;

  &::after {
    display: none;
  }

  .van-cell__title {
    flex: 1;
    min-width: 0;
  }
}

:deep(.van-checkbox__icon--checked) {
  .van-icon {
    background-color: var(--theme-theme);
    border-color: var(--theme-theme);
  }
}

:deep(.van-empty) {
  padding: 32px 0;
  background: transparent;
}
</style>
