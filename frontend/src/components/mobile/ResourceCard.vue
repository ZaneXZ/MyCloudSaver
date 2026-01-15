<template>
  <div class="resource-card">
    <div v-for="item in dataList" :key="item.id" class="resource-card__item">
      <!-- 内容区域 -->
      <div class="item__content">
        <!-- 左侧图片 -->
        <div class="content__image">
          <van-image
            :src="getProxyImageUrl(item.image as string)"
            :fit="item.image ? 'cover' : 'contain'"
            lazy-load
          />
          <!-- 来源标签移到图片左上角 -->
          <van-tag class="image__tag" :color="getTagColor(item.cloudType)" round>
            {{ item.cloudType }}
          </van-tag>
        </div>

        <!-- 右侧信息 -->
        <div class="content__info">
          <!-- 标题 -->
          <div class="info__title" @click="copyUrl(item.cloudLinks[0])">
            {{ item.title }}
          </div>

          <!-- 描述 - 添加展开收起功能 -->
          <div
            class="info__desc"
            :class="{
              'is-expanded': expandedItems[(item.messageId || '') + (item.channelId || '')],
            }"
            @click="toggleExpand((item.messageId || '') + (item.channelId || ''))"
            v-html="item.content"
          />

          <!-- 底部区域：标签 -->
          <div class="info__footer">
            <div v-if="item.tags?.length" class="info__tags">
              <van-tag
                v-for="tag in item.tags"
                :key="tag"
                type="primary"
                plain
                round
                @click.stop="searchMovieforTag(tag)"
              >
                {{ tag }}
              </van-tag>
            </div>

            <!-- 转存按钮 -->
            <div class="info__action">
              <van-button type="primary" size="mini" round plain @click="handleJump(item)">
                跳转
              </van-button>
              <van-button
                v-if="item.isSupportSave"
                type="primary"
                size="mini"
                round
                @click="handleSave(item)"
                >转存</van-button
              >
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useResourceStore } from "@/stores/resource";
import { showNotify } from "vant";
import type { ResourceItem } from "@/types";
import { getProxyImageUrl } from "@/utils/image";

// Props 定义
const props = defineProps<{
  currentChannelId: string;
}>();

// 事件定义
const emit = defineEmits<{
  (e: "save", resource: ResourceItem): void;
  (e: "jump", resource: ResourceItem): void;
  (e: "searchMovieforTag", tag: string): void;
}>();

// 状态管理
const store = useResourceStore();

// 计算属性
const dataList = computed(() => {
  const channel = store.resources.find((item) => item.id === props.currentChannelId);
  return channel?.list || [];
});

// 标签颜色映射
const getTagColor = (type?: string) => {
  const colorMap: Record<string, string> = {
    pan115: "#07c160",
    quark: "#1989fa",
  };
  return colorMap[type || ""] || "#ff976a";
};

// 方法定义
const handleSave = (resource: ResourceItem) => {
  emit("save", resource);
};

const handleJump = (resource: ResourceItem) => {
  emit("jump", resource);
};

const copyUrl = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url);
    showNotify({
      type: "success",
      message: "链接已复制到剪贴板",
      duration: 1500,
    });
  } catch (err) {
    const input = document.createElement("input");
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);

    showNotify({
      type: "success",
      message: "链接已复制到剪贴板",
      duration: 1500,
    });
  }
};

const searchMovieforTag = (tag: string) => {
  emit("searchMovieforTag", tag);
};

// 展开状态管理
const expandedItems = ref<Record<string, boolean>>({});

// 切换展开状态
const toggleExpand = (id: string) => {
  expandedItems.value[id] = !expandedItems.value[id];
};
</script>

<style lang="scss" scoped>
// 文本省略混入 - 移到最前面
@mixin text-ellipsis($lines) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: $lines;
  overflow: hidden;
}

.resource-card {
  padding: 5px 10px;

  &__item {
    margin-bottom: 12px;
    background: var(--theme-other_background);
    border-radius: var(--border-radius-lg);
    overflow: hidden;
  }
}

.item {
  &__content {
    display: flex;
    gap: 16px;
    padding: 16px;
  }
}

.content {
  &__image {
    position: relative; // 为标签定位
    flex-shrink: 0;
    width: 100px;
    height: 140px;
    border-radius: var(--border-radius-sm);
    overflow: hidden;
    background: var(--van-gray-2);

    :deep(.van-image) {
      width: 100%;
      height: 100%;
    }

    .image__tag {
      position: absolute;
      top: 8px;
      left: 8px;
      font-size: 10px;
      padding: 0 6px;
    }
  }

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
}

.info {
  &__title {
    font-size: 15px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--theme-color);
    @include text-ellipsis(2);

    &:active {
      opacity: 0.7;
    }
  }

  &__desc {
    position: relative;
    font-size: 13px;
    line-height: 1.6;
    color: var(--van-gray-7);
    @include text-ellipsis(3);
    margin: 4px 0;
    cursor: pointer;
    transition: all 0.3s;

    &.is-expanded {
      -webkit-line-clamp: 8;
    }

    &::after {
      content: "展开";
      position: absolute;
      right: 0;
      bottom: 0;
      padding: 0 4px;
      font-size: 12px;
      color: var(--theme-theme);
      background: var(--theme-other_background);
    }

    &.is-expanded::after {
      content: "收起";
    }
  }

  &__footer {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-top: auto;
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    :deep(.van-tag) {
      font-size: 11px;
      padding: 0 8px;
    }
  }

  &__action {
    display: flex;
    justify-content: flex-end;
    padding: 4px 0;

    .van-button {
      font-size: 13px;
      height: 32px;
      padding: 0 20px;

      :deep(.van-button__text) {
        font-weight: 500;
        font-size: 14px;
      }

      &:active {
        opacity: 0.8;
      }
    }
  }
}
</style>
