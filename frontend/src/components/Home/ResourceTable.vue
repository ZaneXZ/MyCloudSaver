<template>
  <el-table
    v-loading="store.loading"
    class="resource-list-table"
    :data="store.resources"
    style="width: 100%"
    row-key="id"
    :default-expand-all="false"
  >
    <el-table-column type="expand">
      <template #default="props">
        <el-table :data="props.row.list" style="width: 100%">
          <el-table-column label="图片" width="80">
            <template #default="{ row }">
              <el-image
                v-if="row.image"
                class="table-item-image"
                :src="getProxyImageUrl(row.image as string)"
                :fit="row.image ? 'cover' : 'contain'"
                width="30"
                height="60"
              />
              <el-icon v-else size="20"><Close /></el-icon>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="标题" width="280">
            <template #default="{ row }">
              <el-link :href="row.cloudLinks[0]" target="_blank" style="font-weight: bold">
                {{ row.title }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="描述">
            <template #default="{ row }">
              <div class="item-description" v-html="row.content"></div>
            </template>
          </el-table-column>
          <el-table-column prop="tags" label="标签">
            <template #default="{ row }">
              <div v-if="row.tags.length > 0" class="tags-list">
                <span>标签：</span>
                <el-tag
                  v-for="item in row.tags"
                  :key="item"
                  class="resource_tag"
                  @click="searchMovieforTag(item)"
                >
                  {{ item }}
                </el-tag>
              </div>
              <span v-else>无</span>
            </template>
          </el-table-column>
          <el-table-column label="云盘类型" width="120">
            <template #default="{ row }">
              <el-tag :type="store.tagColor[row.cloudType as keyof TagColor]" effect="dark" round>
                {{ row.cloudType }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ row }">
              <el-button type="primary" plain @click="handleJump(row)">跳转</el-button>
              <el-button v-if="row.isSupportSave" @click="handleSave(row)">转存</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="load-more">
          <el-button :loading="props.row.loading" @click="handleLoadMore(props.row.id)">
            加载更多
          </el-button>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="来源" prop="channel">
      <template #default="{ row }">
        <div class="group-header">
          <el-image
            :src="getProxyImageUrl(row.channelInfo.channelLogo as string)"
            class="channel-logo"
            :fit="row.channelInfo.channelLogo ? 'cover' : 'contain'"
            lazy
          />
          <span>{{ row.channelInfo.name }}</span>
          <span class="item-count">({{ row.list.length }})</span>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import { useResourceStore } from "@/stores/resource";
import type { Resource, TagColor } from "@/types";
import { getProxyImageUrl } from "@/utils/image";

const store = useResourceStore();
const emit = defineEmits(["save", "loadMore", "searchMovieforTag", "jump"]);

const handleSave = (resource: Resource) => {
  emit("save", resource);
};

const handleJump = (resource: Resource) => {
  emit("jump", resource);
};

// 添加加载更多处理函数
const handleLoadMore = (channelId: string) => {
  emit("loadMore", channelId);
};

const searchMovieforTag = (tag: string) => {
  emit("searchMovieforTag", tag);
};
</script>

<style scoped>
.resource-list-table {
  border-radius: 15px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.channel-logo {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  border-radius: 50%;
  overflow: hidden;
}

.table-item-image {
  border-radius: 10px;
  width: 100%;
}

.item-count {
  color: #909399;
  font-size: 0.9em;
}
.tags-list {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
}
.resource_tag {
  cursor: pointer;
  margin-right: 10px;
  margin-bottom: 5px;
}
.item-description {
  max-width: 100%;
  margin: 15px 0;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: all;
}

:deep(.el-table__expand-column) {
  .cell {
    padding: 0 !important;
  }
}

:deep(.el-table__expanded-cell) {
  padding: 20px !important;
}

:deep(.el-table__expand-icon) {
  height: 23px;
  line-height: 23px;
}
.load-more {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.resource-table {
  position: relative;
  height: auto;
  overflow: visible;
}
</style>
