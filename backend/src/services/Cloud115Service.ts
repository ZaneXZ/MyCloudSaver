import { AxiosHeaders, AxiosInstance } from "axios";
import { createAxiosInstance } from "../utils/axiosInstance";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import UserSetting from "../models/UserSetting";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";

@injectable()
export class Cloud115Service implements ICloudStorageService {
  private api: AxiosInstance;
  public cookie: string = ""; 

  constructor() {
    this.api = createAxiosInstance(
      "https://webapi.115.com",
      AxiosHeaders.from({
        Host: "webapi.115.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        Referer: "https://115.com/",
      })
    );

    this.api.interceptors.request.use((config) => {
      config.headers.cookie = this.cookie;
      return config;
    });
  }

  /**
   * 核心新增：通过路径字符串获取文件夹 CID
   * 支持格式: "/电影/欧美" 或 "电影/欧美"
   */
  async getCidByPath(path: string): Promise<string> {
    const folders = path.split('/').filter(p => p.trim() !== "");
    let currentCid = "0"; // 从根目录开始

    for (const folderName of folders) {
      const response = await this.api.get("/files", {
        params: { cid: currentCid, show_dir: 1, limit: 100, format: "json" }
      });

      const list = response.data?.data || [];
      // 过滤出名字匹配且是文件夹的项目 (n 是名称, fid 存在通常表示是文件, cid 存在表示是文件夹)
      const target = list.find((item: any) => item.n === folderName && !item.fid); 
      
      if (target) {
        currentCid = target.cid;
      } else {
        throw new Error(`在目录(ID:${currentCid})下未找到文件夹: "${folderName}"`);
      }
    }
    return currentCid;
  }

  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 20, cid: "" },
    });

    const resData = response.data;
    if (resData?.state && resData.data) {
      const title = resData.data.share_title || resData.data.title || resData.data.snap_info?.title || (resData.data.list && resData.data.list[0]?.n) || "未知资源";
      return {
        data: {
          share_title: title,
          list: (resData.data.list || []).map((item: any) => ({
            fileId: item.cid || item.fid,
            fileName: item.n || item.fn,
            fileSize: item.s || item.fz,
          })),
        },
      };
    } else {
      throw new Error(resData?.error || "115接口授权失败");
    }
  }

  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const param = new URLSearchParams({
      cid: params.folderId || "0",       // 确保是 cid
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      fid: params.fids?.join(",") || "", // 确保是 fid
    });

    const response = await this.api.post("/share/receive", param.toString());
    if (response.data.state) {
      return { message: "成功", data: response.data.data };
    } else {
      throw new Error(response.data.error || "115转存被拒绝");
    }
  }

  // 实现接口要求的其他方法...
  async setCookie(req: Request): Promise<void> { /* 已有逻辑 */ }
  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", { params: { cid: parentCid, format: "json" } });
    return { data: response.data?.data?.map((f:any)=>({ cid:f.cid, name:f.n })) || [] };
  }
}
