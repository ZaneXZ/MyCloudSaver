import axios from "axios"; // 必须直接导入原生 axios，跳过项目封装的 createAxiosInstance
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";

@injectable()
export class Cloud115Service implements ICloudStorageService {
  public cookie: string = ""; 

  /**
   * 模仿 CloudSaver 原版成功的请求头配置
   */
  private getHeaders(referer: string = "https://115.com/") {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer,
      "Cookie": this.cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Origin": "https://115.com"
    };
  }

  /**
   * 修复设置路径：使用原生 axios 获取
   */
  async resolvePathToId(path: string): Promise<string> {
    const folders = path.split(/[\/\\]/).filter(p => p.trim() !== "");
    let currentCid = "0";

    for (const folderName of folders) {
      // 必须直接使用 axios.get，不使用 this.api
      const res = await axios.get("https://webapi.115.com/files", {
        params: { cid: currentCid, show_dir: 1, format: "json" },
        headers: this.getHeaders()
      });

      const list = res.data?.data || [];
      const target = list.find((item: any) => (item.n || item.name) === folderName);

      if (target) {
        currentCid = target.cid || target.id;
      } else {
        throw new Error(`路径不存在: "${folderName}"，请先在 115 网页端创建。`);
      }
    }
    return currentCid;
  }

  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      const res = await axios.get(`https://webapi.115.com/files/getid?cid=${cid}`, {
        headers: this.getHeaders()
      });
      const paths = res.data?.data || [];
      if (Array.isArray(paths) && paths.length > 0) {
        return paths.map((p: any) => p.name).join(" > ");
      }
      return `目录(${cid})`;
    } catch { return `目录(${cid})`; }
  }

  /**
   * 核心转存修复：完全隔离全局拦截器
   */
  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const url = "https://115.com/webapi/share/receive";
    
    // 关键点 1：手动构造字符串负载，绝对不传对象
    const postData = new URLSearchParams();
    postData.append("cid", params.folderId || "0");
    postData.append("share_code", params.shareCode);
    postData.append("receive_code", params.receiveCode || "");
    postData.append("fid", params.fids?.join(",") || "");

    try {
      // 关键点 2：直接调用原生 axios，确保没有拦截器干扰
      const res = await axios({
        method: "post",
        url: url,
        data: postData.toString(),
        headers: this.getHeaders(`https://115.com/s/${params.shareCode}`)
      });

      if (res.data && res.data.state) {
        return { message: "成功", data: res.data.data };
      }
      throw new Error(res.data?.error || res.data?.msg || "115转存拒绝");
    } catch (error: any) {
      if (error.response?.status === 405) {
        throw new Error("405 Method Not Allowed: 请检查后端 axiosInstance 是否定义了冲突的全局 Header");
      }
      throw error;
    }
  }

  // 其他方法适配原生 axios
  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const res = await axios.get("https://webapi.115.com/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode },
      headers: this.getHeaders(`https://115.com/s/${shareCode}`)
    });
    if (res.data?.state) {
      return {
        data: {
          share_title: res.data.data?.share_title || "未知",
          list: (res.data.data?.list || []).map((i: any) => ({ fileId: i.fid || i.cid, fileName: i.n, fileSize: Number(i.s || 0) }))
        }
      };
    }
    throw new Error(res.data?.error || "快照解析失败");
  }

  async setCookie(req: Request): Promise<void> {}
  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const res = await axios.get("https://webapi.115.com/files", {
      params: { cid: parentCid, format: "json" },
      headers: this.getHeaders()
    });
    return { data: res.data?.data?.map((f: any) => ({ cid: f.cid, name: f.n })) || [] };
  }
}
