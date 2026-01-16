import { AxiosHeaders, AxiosInstance } from "axios";
import { createAxiosInstance } from "../utils/axiosInstance";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "../types/cloud";
import { injectable } from "inversify";
import { Request } from "express";
import UserSetting from "../models/UserSetting";
import { ICloudStorageService } from "@/types/services";
import { logger } from "../utils/logger";

interface Cloud115ListItem {
  cid: string;
  n: string;
  s: number;
}

interface Cloud115FolderItem {
  cid: string;
  n: string;
  ns: number;
}

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

  async setCookie(req: Request): Promise<void> {
    const userId = req.user?.userId;
    const userSetting = await UserSetting.findOne({ where: { userId } });
    if (userSetting && userSetting.dataValues.cloud115Cookie) {
      this.cookie = userSetting.dataValues.cloud115Cookie;
    } else {
      throw new Error("未找到115 Cookie");
    }
  }

  /**
   * 获取分享信息（增强调试版）
   */
  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    logger.info(`🔍 [115请求] 正在获取分享详情: ${shareCode} / 码: ${receiveCode}`);
    
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 20, cid: "" },
    });

    const resData = response.data;

    // --- 【调试日志开始】 ---
    // 这行会在控制台打印出 115 返回的原始结构，你可以看到标题到底在哪
    console.log("----------------- 115 接口原始响应 -----------------");
    console.log(JSON.stringify(resData, null, 2));
    console.log("---------------------------------------------------");
    // --- 【调试日志结束】 ---

    if (resData?.state && resData.data) {
      // 深度提取标题：115 不同接口版本可能叫 title, share_title 或在 snap_info 里
      const title = 
        resData.data.share_title || 
        resData.data.title || 
        resData.data.snap_info?.title ||
        (resData.data.list && resData.data.list[0]?.n) || 
        "未知资源名称";
      
      logger.info(`✨ [115解析] 成功提取标题: ${title}`);

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
      logger.error("❌ [115错误] 响应状态异常:", resData);
      throw new Error(resData?.error || "115 接口授权失败或链接失效");
    }
  }

  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", {
      params: { aid: 1, cid: parentCid, o: "user_ptime", asc: 1, offset: 0, show_dir: 1, limit: 50, format: "json" },
    });
    if (response.data?.state) {
      return {
        data: response.data.data
          .filter((item: Cloud115FolderItem) => item.cid)
          .map((folder: Cloud115FolderItem) => ({
            cid: folder.cid,
            name: folder.n,
            path: response.data.path,
          })),
      };
    } else {
      throw new Error("获取目录失败");
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
      return {
        message: response.data.error || "转存成功",
        data: response.data.data,
      };
    } else {
      logger.error("❌ [115转存失败]:", response.data.error);
      throw new Error(response.data.error || "转存请求被115拒绝");
    }
  }
}
