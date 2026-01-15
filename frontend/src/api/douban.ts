import request from "@/utils/request";
import { HotListItem, HotListParams } from "@/types/douban";

export const doubanApi = {
  async getHotList(params: HotListParams) {
    const { data } = await request.get<HotListItem[]>("/api/douban/hot", {
      params,
    });
    return data;
  },
};
