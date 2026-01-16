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
        Origin: "https://115.com",
      })
    );

    this.api.interceptors.request.use((config) => {
      config.headers.cookie = this.cookie;
      return config;
    });
  }

  /**
   * 修复：根据 CID 获取完整路径名
   * 适配 115 不同的返回结构
   */
  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      // 115 的 getid 接口是获取路径树最准确的
      const response = await this.api.get("/files/getid", {
        params: { cid: cid }
      });
      
      const resData = response.data;
      // 检查 data 是否为数组（路径链）
      const paths = resData?.data || [];
      if (Array.isArray(paths) && paths.length > 0) {
        return paths.map((p: any) => p.name).filter(Boolean).join(" > ");
      }
      
      // 备选方案：如果 getid 没返回数组，尝试获取单层目录名
      return resData?.name || `目录(${cid})`;
    } catch (error) {
      logger.error(`[115Service] 获取目录名失败: ${cid}`);
      return `目录(${cid})`;
    }
  }

  /**
   * 修复：解析并自动创建文件夹
   * 增加 Content-Type 处理防止 405
   */
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
        // 关键点：使用 URLSearchParams 并设置正确的 Header
        const params = new URLSearchParams();
        params.append("pid", currentCid);
        params.append("name", folderName);

        const createRes = await this.api.post("/files/add", params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
        
        if (createRes.data && createRes.data.state) {
          currentCid = createRes.data.cid;
        } else {
          throw new Error(`创建文件夹 "${folderName}" 失败: ${createRes.data?.error || '接口拒绝'}`);
        }
      }
    }
    return currentCid;
  }

  /**
   * 优化：支持多域名快照获取
   */
  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 100, cid: "" },
    });

    const resData = response.data;
    if (resData?.state && resData.data) {
      const title = resData.data.share_title || resData.data.title || "未知资源";
      return {
        data: {
          share_title: title,
          list: (resData.data.list || []).map((item: any) => ({
            fileId: item.fid || item.cid,
            fileName: item.n || item.fn,
            fileSize: Number(item.s || item.fz || 0),
          })),
        },
      };
    } else {
      throw new Error(resData?.error || "115链接提取失败");
    }
  }

  /**
   * 核心修复：解决转存 405 错误
   */
  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    // 修复点 1：必须使用 URLSearchParams
    const body = new URLSearchParams();
    body.append("cid", params.folderId || "0");
    body.append("share_code", params.shareCode || "");
    body.append("receive_code", params.receiveCode || "");
    body.append("fid", params.fids?.join(",") || "");

    // 修复点 2：显式指定 Content-Type 和 Referer
    const response = await this.api.post("/share/receive", body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": "https://115.com/",
      }
    });

    if (response.data && response.data.state) {
      return { message: "成功", data: response.data.data };
    } else {
      // 常见错误：115 可能会返回 "签名错误" 或 "请重新登录"
      throw new Error(response.data?.error || response.data?.msg || "115转存失败");
    }
  }

  async setCookie(req: Request): Promise<void> {}

  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", { params: { cid: parentCid, format: "json" } });
    return { data: response.data?.data?.map((f:any)=>({ cid:f.cid, name:f.n })) || [] };
  }
}
