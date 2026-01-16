import { AxiosHeaders, AxiosInstance } from "axios";
import { createAxiosInstance } from "../utils/axiosInstance";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";
import qs from "qs"; // 如果没安装，请运行 npm install qs

@injectable()
export class Cloud115Service implements ICloudStorageService {
  private api: AxiosInstance;
  public cookie: string = ""; 

  constructor() {
    // 1. 初始化实例，移除 Host，增强 UA
    this.api = createAxiosInstance(
      "https://webapi.115.com",
      AxiosHeaders.from({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://115.com/",
        "Origin": "https://115.com",
        "X-Requested-With": "XMLHttpRequest"
      })
    );

    this.api.interceptors.request.use((config) => {
      config.headers.cookie = this.cookie;
      return config;
    });
  }

  // 获取完整路径名
  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      const response = await this.api.get("/files/getid", { params: { cid } });
      const paths = response.data?.data || [];
      if (Array.isArray(paths) && paths.length > 0) {
        return paths.map((p: any) => p.name).filter(Boolean).join(" > ");
      }
      return response.data?.name || `目录(${cid})`;
    } catch (error) {
      return `目录(${cid})`;
    }
  }

  // 解析并创建文件夹 (修复 405)
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
        // 关键修复：显式使用 qs 或 URLSearchParams 序列化，并手动指定 Header
        const postData = qs.stringify({ pid: currentCid, name: folderName });
        
        const createRes = await this.api.post("/files/add", postData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
        });
        
        if (createRes.data && createRes.data.state) {
          currentCid = createRes.data.cid;
        } else {
          throw new Error(`创建文件夹失败: ${createRes.data?.error || '接口拦截'}`);
        }
      }
    }
    return currentCid;
  }

  // 获取分享快照
  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 100 },
    });
    const resData = response.data;
    if (resData?.state && resData.data) {
      return {
        data: {
          share_title: resData.data.share_title || resData.data.title || "未知资源",
          list: (resData.data.list || []).map((item: any) => ({
            fileId: item.fid || item.cid,
            fileName: item.n || item.fn,
            fileSize: Number(item.s || item.fz || 0),
          })),
        },
      };
    }
    throw new Error(resData?.error || "115授权失效");
  }

  // 转存文件 (修复 405)
  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const postData = qs.stringify({
      cid: params.folderId || "0",
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      fid: params.fids?.join(",") || "",
    });

    // 尝试直接访问主站 API 路径，增加稳定性
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
