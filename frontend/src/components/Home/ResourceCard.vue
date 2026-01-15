<template>
  <div class="resource-card">
    <!-- 详情弹窗 -->
    <el-dialog
      v-model="showDetail"
      :title="currentResource?.title"
      width="700px"
      class="resource-detail-dialog"
      destroy-on-close
    >
      <div v-if="currentResource" class="detail-content">
        <div class="detail-cover">
          <el-image
            class="cover-image"
            :src="getProxyImageUrl(currentResource.image as string)"
            :fit="currentResource.image ? 'cover' : 'contain'"
          />
          <el-tag
            class="cloud-type"
            :type="store.tagColor[currentResource.cloudType as keyof TagColor]"
            effect="dark"
            round
          >
            {{ currentResource.cloudType }}
          </el-tag>
        </div>
        <div class="detail-info">
          <h3 class="detail-title">
            <el-link :href="currentResource.cloudLinks[0]" target="_blank" :underline="false">
              {{ currentResource.title }}
            </el-link>
          </h3>
          <div class="detail-description" v-html="currentResource.content" />
          <div v-if="currentResource.tags?.length" class="detail-tags">
            <div class="tags-list">
              <el-tag
                v-for="tag in currentResource.tags"
                :key="tag"
                class="tag-item"
                @click="searchMovieforTag(tag)"
              >
                {{ tag }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" plain @click="currentResource && handleJump(currentResource)"
            >跳转</el-button
          >
          <el-button
            v-if="currentResource?.isSupportSave"
            type="primary"
            @click="currentResource && handleSave(currentResource)"
            >转存</el-button
          >
        </div>
      </template>
    </el-dialog>

    <div v-for="group in store.resources" :key="group.id" class="resource-group">
      <div
        :class="{ 'group-header': true, 'is-active': group.displayList }"
        @click="group.displayList = !group.displayList"
      >
        <el-link
          class="group-title"
          :href="`https://t.me/s/${group.id}`"
          target="_blank"
          :underline="false"
          @click.stop
        >
          <el-image
            :src="getProxyImageUrl(group.channelInfo.channelLogo)"
            :fit="group.channelInfo.channelLogo ? 'cover' : 'contain'"
            class="channel-logo"
            scroll-container="#pc-resources-content"
            loading="lazy"
          />
          <span>{{ group.channelInfo.name }}</span>
          <span class="item-count">({{ group.list.length }})</span>
        </el-link>

        <el-tooltip effect="dark" :content="group.displayList ? '收起' : '展开'" placement="top">
          <el-button class="toggle-btn" type="text">
            <el-icon :class="{ 'is-active': group.displayList }">
              <ArrowDown />
            </el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <div v-if="group.displayList" class="group-content">
        <div class="card-grid">
          <el-card
            v-for="resource in group.list"
            :key="resource.messageId"
            class="resource-card-item"
            :body-style="{ padding: '0' }"
          >
            <div class="card-wrapper">
              <div class="card-cover">
                <el-image
                  loading="lazy"
                  class="cover-image"
                  :src="getProxyImageUrl(resource.image as string)"
                  :fit="resource.image ? 'cover' : 'contain'"
                  :alt="resource.title"
                  @click="showResourceDetail(resource)"
                />
                <el-tag
                  class="cloud-type"
                  :type="store.tagColor[resource.cloudType as keyof TagColor]"
                  effect="dark"
                  round
                  size="small"
                >
                  {{ resource.cloudType }}
                </el-tag>
              </div>

              <div class="card-body">
                <el-link
                  class="card-title"
                  :href="resource.cloudLinks[0]"
                  target="_blank"
                  :underline="false"
                >
                  {{ resource.title }}
                </el-link>

                <div
                  class="card-content"
                  @click="showResourceDetail(resource)"
                  v-html="resource.content"
                />

                <div v-if="resource.tags?.length" class="card-tags">
                  <div class="tags-list">
                    <el-tag
                      v-for="tag in resource.tags"
                      :key="tag"
                      class="tag-item"
                      @click="searchMovieforTag(tag)"
                    >
                      {{ tag }}
                    </el-tag>
                  </div>
                </div>

                <div class="card-footer">
                  <el-button type="primary" plain @click="handleJump(resource)">跳转</el-button>
                  <el-button
                    v-if="resource.isSupportSave"
                    type="primary"
                    @click="handleSave(resource)"
                    >转存</el-button
                  >
                </div>
              </div>
            </div>
          </el-card>
        </div>

        <div class="load-more">
          <el-button :loading="group.loading" @click="handleLoadMore(group.id)">
            <el-icon><Plus /></el-icon>
            加载更多
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResourceStore } from "@/stores/resource";
import { ref } from "vue";
import type { ResourceItem, TagColor } from "@/types";
import { ArrowDown, Plus } from "@element-plus/icons-vue";
import { getProxyImageUrl } from "@/utils/image";

const store = useResourceStore();

const showDetail = ref(false);
const currentResource = ref<ResourceItem | null>(null);

const emit = defineEmits(["save", "loadMore", "jump", "searchMovieforTag"]);

const handleSave = (resource: ResourceItem) => {
  if (showDetail.value) {
    showDetail.value = false;
  }
  emit("save", resource);
};

const handleJump = (resource: ResourceItem) => {
  emit("jump", resource);
};

const showResourceDetail = (resource: ResourceItem) => {
  currentResource.value = resource;
  showDetail.value = true;
};

const searchMovieforTag = (tag: string) => {
  emit("searchMovieforTag", tag);
};

const handleLoadMore = (channelId: string) => {
  emit("loadMore", channelId);
};
</script>

<style lang="scss" scoped>
@import "@/styles/common.scss";

.resource-card {
  position: relative;
  height: 100%;

  // 资源组
  .resource-group {
    background: var(--theme-card-bg);
    backdrop-filter: var(--theme-blur);
    -webkit-backdrop-filter: var(--theme-blur);
    margin-bottom: 24px;
    border-radius: var(--theme-radius);
    border: 1px solid rgba(0, 0, 0, 0.08);
    transition: var(--theme-transition);

    &:last-child {
      margin-bottom: 100px;
    }
  }

  // 组标题
  .group-header {
    @include flex-center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    position: sticky;
    top: 0;
    background: var(--theme-card-bg);
    backdrop-filter: var(--theme-blur);
    -webkit-backdrop-filter: var(--theme-blur);
    z-index: 10;
    border-radius: var(--theme-radius);
    overflow: hidden;
    cursor: pointer;

    &.is-active {
      border-radius: var(--theme-radius) var(--theme-radius) 0 0;
    }

    .group-title {
      @include flex-center;
      gap: 12px;
      font-size: 16px;
      color: var(--theme-text-primary);
      transition: var(--theme-transition);

      .channel-logo {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        overflow: hidden;
        box-shadow: var(--theme-shadow-sm);
        margin-right: 8px;
      }

      .item-count {
        font-size: 13px;
        color: var(--theme-text-secondary);
      }

      &:hover {
        color: var(--theme-primary);
        transform: translateY(-1px);
      }
    }

    .toggle-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      color: var(--theme-text-regular);
      transition: var(--theme-transition);

      .el-icon {
        font-size: 16px;
        transition: transform 0.3s ease;

        &.is-active {
          transform: rotate(180deg);
        }
      }

      &:hover {
        color: var(--theme-primary);
        transform: translateY(-1px);
      }
    }
  }

  // 组内容
  .group-content {
    padding: 20px;
  }

  // 卡片网格
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 24px;
    grid-auto-rows: min-content;
  }

  // 资源卡片
  .resource-card-item {
    border-radius: var(--theme-radius);
    transition: var(--theme-transition);
    overflow: hidden;
    max-width: 460px;
    margin: 0 auto;
    width: 100%;
    height: fit-content;

    &:hover {
      transform: translateY(-2px);
      box-shadow: var(--theme-shadow);
    }

    .card-wrapper {
      display: flex;
      gap: 20px;
      padding: 16px;
      height: 100%;
    }

    .card-cover {
      position: relative;
      width: 120px;
      height: 180px;
      flex-shrink: 0;

      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--theme-radius);
        cursor: pointer;
        transition: opacity 0.3s ease;

        &:hover {
          opacity: 0.85;
        }
      }

      .cloud-type {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 1;
      }
    }

    .card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;

      .card-title {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 16px;
        line-height: 1.5;
        color: var(--theme-text-primary);
        word-break: break-word;
        height: 3em;
        transition: var(--theme-transition);

        &:hover {
          color: var(--theme-primary);
        }
      }

      .card-content {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 14px;
        line-height: 1.6;
        color: var(--theme-text-regular);
        cursor: pointer;
        transition: color 0.3s ease;

        &:hover {
          color: var(--theme-text-primary);
        }
      }

      .card-tags {
        margin-top: auto;
        max-height: 88px;
        overflow: hidden;

        .tags-label {
          font-size: 13px;
          color: var(--theme-text-secondary);
          margin-right: 8px;
          display: block;
          margin-bottom: 8px;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          max-height: 72px;
          overflow: hidden;

          .tag-item {
            cursor: pointer;
            transition: var(--theme-transition);
            margin: 0;
            height: 24px;

            &:hover {
              color: var(--theme-primary);
              border-color: var(--theme-primary);
              transform: translateY(-1px);
            }
          }
        }
      }
    }

    .card-footer {
      @include flex-center;
      justify-content: flex-end;
      margin-top: 8px;

      .el-button {
        padding: 6px 16px;
        font-size: 14px;
        height: 32px;
        min-width: 80px;

        &:hover {
          transform: translateY(-1px);
          box-shadow: var(--theme-shadow-sm);
        }
      }
    }
  }

  // 加载更多
  .load-more {
    @include flex-center;
    position: relative;
    padding: 32px 0 8px;
    margin-top: 16px;

    &::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent,
        var(--el-border-color-lighter) 20%,
        var(--el-border-color-lighter) 80%,
        transparent
      );
    }

    .el-button {
      min-width: 160px;
      height: 40px;
      border-radius: 20px;
      font-size: 14px;
      color: var(--theme-text-regular);
      background: var(--theme-card-bg);
      border: 1px solid var(--el-border-color-lighter);
      transition: var(--theme-transition);
      position: relative;
      overflow: hidden;

      &::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
        transform: translateX(-100%);
        transition: transform 0.6s ease;
      }

      &:hover {
        color: var(--theme-primary);
        border-color: var(--theme-primary);
        background: var(--el-color-primary-light-9);

        &::after {
          transform: translateX(100%);
        }
      }

      &.is-loading {
        color: var(--theme-text-secondary);

        &::after {
          display: none;
        }
      }

      .el-icon {
        margin-right: 6px;
        font-size: 16px;
      }
    }
  }

  // 详情弹窗样式
  .resource-detail-dialog {
    :deep(.el-dialog__body) {
      padding: 20px;
    }

    .detail-content {
      display: flex;
      gap: 24px;
    }

    .detail-cover {
      position: relative;
      width: 200px;
      flex-shrink: 0;

      .cover-image {
        width: 100%;
        height: 300px;
        border-radius: var(--theme-radius);
        overflow: hidden;
      }

      .cloud-type {
        position: absolute;
        top: 8px;
        left: 8px;
        z-index: 1;
      }
    }

    .detail-info {
      flex: 1;
      min-width: 0;

      .detail-title {
        font-size: 18px;
        margin: 0 0 16px;
        line-height: 1.5;
        color: var(--theme-text-primary);
      }

      .detail-description {
        font-size: 14px;
        line-height: 1.6;
        color: var(--theme-text-regular);
        margin-bottom: 20px;
      }

      .detail-tags {
        .tags-label {
          font-size: 13px;
          color: var(--theme-text-secondary);
          margin-right: 8px;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;

          .tag-item {
            cursor: pointer;
            transition: var(--theme-transition);

            &:hover {
              color: var(--theme-primary);
              border-color: var(--theme-primary);
              transform: translateY(-1px);
            }
          }
        }
      }
    }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: 16px;
    }
  }
}
</style>
