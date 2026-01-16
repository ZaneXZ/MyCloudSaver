import { AxiosHeaders, AxiosInstance } from "axios";
import { createAxiosInstance } from "../utils/axiosInstance";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";
import qs from "qs";

@injectable()
export class Cloud115Service implements ICloudStorageService {
  private api: AxiosInstance;
  public cookie: string = ""; 

  constructor() {
    this.api = createAxiosInstance(
      "https://webapi.115.com",
      AxiosHeaders.from({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": "https://115.com/",
        "X-Requested-With": "XMLHttpRequest"
      })
    );

    this.api.interceptors.request.use((config) => {
      config.headers.cookie = this.cookie;
      return config;
    });
  }

  // 获取完整路径文字
  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      const response = await this.api.get("/files/getid", { params: { cid } });
      const paths = response.data?.data || [];
      if (Array.isArray(paths) && paths.length > 0) {
        return paths.map((p: any) => p.name).filter(Boolean).join(" > ");
      }
      return `目录(${cid})`;
    } catch (error) {
      return `目录(${cid})`;
    }
  }

  // 仅检索已有路径，不创建
  async resolvePathToId(path: string): Promise<string> {
    const folders = path.split(/[\/\\]/).filter(p => p.trim() !== "");
    let currentCid = "0";

    for (const folderName of folders) {
      const response = await this.api.get("/files", {
        params: { cid: currentCid, show_dir: 1, limit: 1000, format: "json" }
      });
      
      const list = response.data?.data || [];
      const target = list.find((item: any) => (item.n || item.name) === folderName);

      if (target) {
        currentCid = target.cid || target.id;
      } else {
        throw new Error(`路径不存在: "${folderName}"，请先在 115 网页端创建。`);
      }
    }
    return currentCid;
  }

  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 100 },
    });
    const resData = response.data;
    if (resData?.state) {
      return {
        data: {
          share_title: resData.data?.share_title || "未知资源",
          list: (resData.data?.list || []).map((item: any) => ({
            fileId: item.fid || item.cid,
            fileName: item.n || item.fn,
            fileSize: Number(item.s || item.fz || 0),
          })),
        },
      };
    }
    throw new Error(resData?.error || "115链接提取失败");
  }

  // 转存依然需要 POST，但使用了更稳妥的 qs 序列化
  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const postData = qs.stringify({
      cid: params.folderId || "0",
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      fid: params.fids?.join(",") || "",
    });

    const response = await this.api.post("https://115.com/webapi/share/receive", postData, {
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": `https://115.com/s/${params.shareCode}`
      }
    });

    if (response.data && response.data.state) {
      return { message: "成功", data: response.data.data };
    }
    throw new Error(response.data?.error || response.data?.msg || "转存失败");
  }

  async setCookie(req: Request): Promise<void> {}
  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", { params: { cid: parentCid, format: "json" } });
    return { data: response.data?.data?.map((f:any)=>({ cid:f.cid, name:f.n })) || [] };
  }
}
