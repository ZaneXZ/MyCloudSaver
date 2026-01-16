import axios from "axios"; // 直接引入原生 axios，不使用 createAxiosInstance
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";

@injectable()
export class Cloud115Service implements ICloudStorageService {
  public cookie: string = ""; 

  // 定义一个干净的请求头生成器
  private getHeaders(referer: string = "https://115.com/") {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://115.com",
      "Referer": referer,
      "Cookie": this.cookie,
      "Connection": "keep-alive"
    };
  }

  // 获取路径
  async getFolderNameById(cid: string): Promise<string> {
    if (!cid || cid === "0") return "根目录";
    try {
      const res = await axios.get(`https://webapi.115.com/files/getid?cid=${cid}`, {
        headers: this.getHeaders()
      });
      const paths = res.data?.data || [];
      return Array.isArray(paths) ? paths.map((p: any) => p.name).join(" > ") : `目录(${cid})`;
    } catch { return `目录(${cid})`; }
  }

  // 路径解析 (GET 模式)
  async resolvePathToId(path: string): Promise<string> {
    const folders = path.split(/[\/\\]/).filter(p => p.trim() !== "");
    let currentCid = "0";
    for (const folderName of folders) {
      const res = await axios.get("https://webapi.115.com/files", {
        params: { cid: currentCid, show_dir: 1, format: "json" },
        headers: this.getHeaders()
      });
      const target = (res.data?.data || []).find((item: any) => (item.n || item.name) === folderName);
      if (target) currentCid = target.cid || target.id;
      else throw new Error(`路径不存在: ${folderName}`);
    }
    return currentCid;
  }

  // 获取分享快照
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
    throw new Error(res.data?.error || "115快照获取失败");
  }

  // 转存 (POST 模式) - 彻底重构
  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const url = "https://115.com/webapi/share/receive";
    
    // 关键：手动拼接字符串，不使用任何对象，确保字节流纯净
    const postData = [
      `cid=${params.folderId || "0"}`,
      `share_code=${params.shareCode}`,
      `receive_code=${params.receiveCode || ""}`,
      `fid=${params.fids?.join(",") || ""}`
    ].join("&");

    logger.info(`[115Service] 正在转存: ${params.shareCode}`);

    try {
      const res = await axios({
        method: 'post',
        url: url,
        data: postData, // 发送纯字符串
        headers: this.getHeaders(`https://115.com/s/${params.shareCode}`)
      });

      if (res.data && res.data.state) {
        return { message: "成功", data: res.data.data };
      }
      throw new Error(res.data?.error || res.data?.msg || "转存失败");
    } catch (error: any) {
      if (error.response?.status === 405) {
        throw new Error("405错误：请求被115拒绝。请检查Docker容器是否挂了代理，或尝试更换User-Agent。");
      }
      throw error;
    }
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
