<template>
  <div class="douban-page">
    <div class="movie-wall">
      <div v-for="movie in doubanStore.hotList" :key="movie.id" class="movie-item">
        <div class="movie-poster">
          <el-image
            class="movie-poster-img"
            :src="movie.cover"
            fit="cover"
            lazy
            :alt="movie.title"
            hide-on-click-modal
            :preview-src-list="[movie.cover]"
          />
          <div class="movie-rate">
            {{ movie.rate }}
          </div>
          <div class="movie-poster-hover" @click="searchMovie(movie.title)">
            <div class="movie-search">
              <el-icon class="search_icon" size="28px"><Search /></el-icon>
            </div>
          </div>
        </div>
        <div class="movie-info">
          <el-link :href="movie.url" target="_blank" :underline="false" class="movie-title">{{
            movie.title
          }}</el-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useDoubanStore } from "@/stores/douban";
interface CurrentParams {
  type: string;
  tag?: string;
}
const router = useRouter();
const route = useRoute();

const routeParams = computed((): CurrentParams => ({ ...route.query }) as unknown as CurrentParams);
const doubanStore = useDoubanStore();
if (routeParams.value) {
  doubanStore.setCurrentParams(routeParams.value);
}

watch(
  () => routeParams.value,
  () => {
    console.log(routeParams.value);
    doubanStore.setCurrentParams(routeParams.value);
  }
);

const searchMovie = (title: string) => {
  router.push({ path: "/", query: { keyword: title } });
};
</script>

<style lang="scss" scoped>
@import "@/styles/common.scss";
@import "@/styles/responsive.scss";

.douban-page {
  height: calc(100vh - 180px);
  overflow-y: auto;

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

.movie-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, 200px);
  justify-content: space-between;
  gap: 20px;
  padding: 4px;
}

.movie-item {
  width: 200px;
  background: var(--theme-card-bg);
  border-radius: var(--theme-radius);
  box-shadow: var(--theme-shadow);
  box-sizing: border-box;
  padding: 12px;
  transition: var(--theme-transition);

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--theme-shadow-lg);
  }
}

.movie-poster-img {
  width: 100%;
  height: 220px;
  object-fit: cover;
  border-radius: var(--theme-radius);
  overflow: hidden;
}

.movie-info {
  padding: 12px 0 4px;
  text-align: center;
  width: 100%;

  .movie-title {
    display: block;
    font-size: 16px;
    font-weight: bold;
    color: var(--theme-text-primary);
    transition: var(--theme-transition);
    @include text-ellipsis;
    max-width: 100%;
    line-height: 1.2;

    &:hover {
      color: var(--theme-primary);
    }
  }
}

.movie-poster {
  width: 100%;
  height: 220px;
  position: relative;
  overflow: hidden;
  border-radius: var(--theme-radius);
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

.movie-poster-hover {
  opacity: 0;
  transition: opacity 0.3s ease;
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(2px);
}

.movie-poster:hover .movie-poster-hover {
  opacity: 1;
}

.movie-rate {
  position: absolute;
  top: 10px;
  right: 10px;
  background: var(--theme-primary);
  color: white;
  padding: 0px 8px;
  border-radius: var(--theme-radius-sm);
  font-size: 14px;
}

.movie-search {
  color: white;
  border-radius: var(--theme-radius);
  font-size: 14px;
  cursor: pointer;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.1);
  }
}
</style>
