import request from "@/utils/request";
import type { ShareInfoResponse, Folder, SaveFileParams, GetShareInfoParams } from "@/types";

export const cloud115Api = {
  async getShareInfo(params: GetShareInfoParams) {
    const { data } = await request.get<ShareInfoResponse>("/api/cloud115/share-info", {
      params,
    });
    return data as ShareInfoResponse;
  },

  async getFolderList(parentCid = "0") {
    const res = await request.get<Folder[]>("/api/cloud115/folders", {
      params: { parentCid },
    });
    return res;
  },

  async saveFile(params: SaveFileParams) {
    const res = await request.post("/api/cloud115/save", params);
    return res;
  },
};
