import request from "@/utils/request";
import type { ShareInfoResponse, Folder, SaveFileParams, GetShareInfoParams } from "@/types";

export const quarkApi = {
  async getShareInfo(params: GetShareInfoParams) {
    const { data } = await request.get<ShareInfoResponse>("/api/quark/share-info", {
      params,
    });
    return data as ShareInfoResponse;
  },

  async getFolderList(parentCid = "0") {
    const data = await request.get<Folder[]>("/api/quark/folders", {
      params: { parentCid },
    });
    return data;
  },

  async saveFile(params: SaveFileParams) {
    return await request.post("/api/quark/save", params);
  },
};
