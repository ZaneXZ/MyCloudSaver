<template>
  <div class="mobile-page douban">
    <!-- 加载状态 -->
    <div v-if="doubanStore.loading" class="douban__loading">
      <van-loading type="spinner" size="24px" vertical>加载中...</van-loading>
    </div>

    <!-- 电影列表 -->
    <div v-else class="douban__grid">
      <div v-for="movie in doubanStore.hotList" :key="movie.id" class="douban__item">
        <!-- 海报卡片 -->
        <div class="douban__poster">
          <van-image
            class="poster__img"
            :src="movie.cover"
            fit="cover"
            lazy
            loading="skeleton"
            :alt="movie.title"
            @click="previewImage(movie.cover)"
          />
          <!-- 评分标签 -->
          <van-tag
            class="poster__rate"
            type="primary"
            :style="{ backgroundColor: getRateColor(movie.rate) }"
          >
            {{ movie.rate }}
          </van-tag>
          <!-- 搜索按钮 -->
          <div class="poster__action" @click.stop="searchMovie(movie.title)">
            <van-icon name="search" size="24" />
          </div>
        </div>
        <!-- 电影信息 -->
        <div class="douban__info">
          <van-button class="info__title" type="default" :url="movie.url" text="text" block>
            {{ movie.title }}
          </van-button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <van-empty v-if="!doubanStore.loading && !doubanStore.hotList.length" description="暂无数据" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useDoubanStore } from "@/stores/douban";
import { showImagePreview } from "vant";

interface CurrentParams {
  type: string;
  tag?: string;
}

// 路由相关
const router = useRouter();
const route = useRoute();
const routeParams = computed((): CurrentParams => ({ ...route.query }) as unknown as CurrentParams);

// 状态管理
const doubanStore = useDoubanStore();

// 监听路由参数变化
watch(
  () => routeParams.value,
  (params) => {
    if (params) {
      doubanStore.setCurrentParams(params);
    }
  },
  { immediate: true }
);

// 方法定义
const searchMovie = (title: string) => {
  router.push({
    path: "/resource",
    query: { keyword: title },
  });
};

const previewImage = (url: string) => {
  showImagePreview({
    images: [url],
    closeable: true,
  });
};

// 根据评分获取颜色
const getRateColor = (rate: string | number) => {
  const numRate = Number(rate);
  if (numRate >= 8) return "#42b883";
  if (numRate >= 6) return "#5853fa";
  return "#f56c6c";
};
</script>

<style lang="scss" scoped>
.douban {
  // 网格布局 - 修改为两列
  &__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-base);
    padding: var(--spacing-base);
  }

  // 电影项
  &__item {
    background: var(--theme-other_background);
    border-radius: var(--border-radius-lg);
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  // 海报区域
  &__poster {
    position: relative;
    aspect-ratio: 2/3;
    background: #f5f5f5;
    overflow: hidden;

    .poster__img {
      width: 100%;
      height: 100%;
      transition: transform 0.3s ease;

      &:active {
        transform: scale(1.05);
      }
    }

    .poster__rate {
      position: absolute;
      top: var(--spacing-xs);
      right: var(--spacing-xs);
      font-size: 13px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: var(--border-radius-lg);
    }

    .poster__action {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.6);
      opacity: 0;
      transition: opacity 0.2s ease;
      color: #fff;

      &:active {
        opacity: 1;
      }
    }
  }

  // 信息区域
  &__info {
    padding: 6px 8px;

    .info__title {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.4;
      color: var(--theme-color);
      text-align: left;
      border: none;

      &:active {
        color: var(--theme-theme);
      }
    }
  }

  // 加载状态
  &__loading {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--theme-background);
    z-index: 1;

    :deep(.van-loading) {
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.7);
      border-radius: 8px;
      color: #fff;
    }
  }
}

// 深度修改 Vant 组件样式
:deep(.van-image) {
  display: block;
  background: #f5f5f5;
}

:deep(.van-tag--primary) {
  border: none;
}

:deep(.van-button) {
  height: auto;
  padding: var(--spacing-xs) 0;
  border: none;
}
</style>
