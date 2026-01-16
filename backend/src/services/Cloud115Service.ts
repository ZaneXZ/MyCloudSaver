import { AxiosHeaders, AxiosInstance } from "axios";
import { createAxiosInstance } from "../utils/axiosInstance";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
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
   * 将文件夹 CID 转换为人类可读名称
   */
  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      const response = await this.api.get("https://webapi.115.com/files/getid", {
        params: { cid: cid }
      });
      return response.data?.name || `目录(${cid})`;
    } catch (error) {
      logger.error(`[115Service] 获取目录名失败: ${cid}`);
      return `目录(${cid})`;
    }
  }

  async getCidByPath(path: string): Promise<string> {
    const folders = path.split('/').filter(p => p.trim() !== "");
    let currentCid = "0";

    for (const folderName of folders) {
      const response = await this.api.get("/files", {
        params: { cid: currentCid, show_dir: 1, limit: 1000, format: "json" }
      });
      const list = response.data?.data || [];
      const target = list.find((item: any) => item.n === folderName && !item.fid); 
      if (target) {
        currentCid = target.cid;
      } else {
        throw new Error(`未找到文件夹: "${folderName}"`);
      }
    }
    return currentCid;
  }

  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 100, cid: "" },
    });

    const resData = response.data;
    if (resData?.state && resData.data) {
      const title = resData.data.share_title || resData.data.title || resData.data.snap_info?.title || (resData.data.list && resData.data.list[0]?.n) || "未知资源";
      return {
        data: {
          share_title: title,
          list: (resData.data.list || []).map((item: any) => ({
            fileId: item.fid || item.cid,
            fileName: item.n || item.fn,
            fileSize: Number(item.s || item.fz || 0), // 确保是数字
          })),
        },
      };
    } else {
      throw new Error(resData?.error || "115接口授权失败");
    }
  }

  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const param = new URLSearchParams({
      cid: params.folderId || "0",
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      fid: params.fids?.join(",") || "",
    });

    const response = await this.api.post("/share/receive", param.toString());
    if (response.data.state) {
      return { message: "成功", data: response.data.data };
    } else {
      throw new Error(response.data.error || "115转存被拒绝");
    }
  }

  async setCookie(req: Request): Promise<void> {}

  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", { params: { cid: parentCid, format: "json" } });
    return { data: response.data?.data?.map((f:any)=>({ cid:f.cid, name:f.n })) || [] };
  }
}
