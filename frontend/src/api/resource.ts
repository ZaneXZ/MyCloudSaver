import request from "@/utils/request";
import type { Resource } from "@/types/index";

export const resourceApi = {
  search(keyword: string, channelId?: string, lastMessageId?: string) {
    return request.get<Resource[]>(`/api/search`, {
      params: { keyword, channelId, lastMessageId },
    });
  },
};
