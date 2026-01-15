import { defineStore } from "pinia";
import { doubanApi } from "@/api/douban";
import { HotListItem } from "@/types/douban";
import { ElMessage } from "element-plus";

interface StoreType {
  hotList: HotListItem[];
  loading: boolean;
  currentParams: CurrentParams;
}

interface CurrentParams {
  type: string;
  tag?: string;
}

export const useDoubanStore = defineStore("douban", {
  state: (): StoreType => ({
    hotList: [],
    loading: false,
    currentParams: {
      type: "movie",
      tag: "热门",
    },
  }),

  actions: {
    async getHotList() {
      this.loading = true;
      try {
        const params = {
          type: this.currentParams.type,
          tag: this.currentParams.tag || "热门",
          page_limit: "20",
          page_start: "0",
        };
        const result = await doubanApi.getHotList(params);
        if (result && result.length > 0) {
          this.hotList = result;
        } else {
          console.log("获取热门列表失败");
          ElMessage.warning("获取热门列表失败");
        }
      } catch (error) {
        ElMessage.error(error || "获取热门列表失败");
      } finally {
        this.loading = false;
      }
    },
    setCurrentParams(currentParams: CurrentParams) {
      this.currentParams = currentParams;
      this.getHotList();
    },
  },
});
