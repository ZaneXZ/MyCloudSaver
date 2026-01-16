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
  public cookie: string = ""; // 改为 public 方便 App 类直接赋值

  constructor() {
    this.api = createAxiosInstance(
      "https://webapi.115.com",
      AxiosHeaders.from({
        Host: "webapi.115.com",
        Connection: "keep-alive",
        xweb_xhr: "1",
        Origin: "",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 MicroMessenger/6.8.0(0x16080000) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.9(0x13080910) XWEB/1227",
        Accept: "*/*",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        Referer: "https://servicewechat.com/wx2c744c010a61b0fa/94/page-frame.html",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9",
      })
    );

    this.api.interceptors.request.use((config) => {
      config.headers.cookie = this.cookie;
      return config;
    });
  }

  async setCookie(req: Request): Promise<void> {
    const userId = req.user?.userId;
    const userSetting = await UserSetting.findOne({
      where: { userId },
    });
    if (userSetting && userSetting.dataValues.cloud115Cookie) {
      this.cookie = userSetting.dataValues.cloud115Cookie;
    } else {
      throw new Error("请先设置115网盘cookie");
    }
  }

  /**
   * 修改后的 getShareInfo
   * 增加了对 share_title 的提取
   */
async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: { share_code: shareCode, receive_code: receiveCode, offset: 0, limit: 20, cid: "" },
    });

    const resData = response.data;
    if (resData?.state && resData.data) {
      // 核心修复：115 标题可能在 data.share_title 或 data.title
      const title = resData.data.share_title || resData.data.title || "未命名资源";
      
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
      throw new Error(resData?.error || "获取分享信息失败");
    }
  }

    const resData = response.data;
    
    // 115 的数据结构通常在 resData.data 中
    if (resData?.state && resData.data?.list) {
      return {
        data: {
          // --- 核心修改：提取分享标题 ---
          share_title: resData.data.share_title || "未命名资源",
          list: resData.data.list.map((item: Cloud115ListItem) => ({
            fileId: item.cid,
            fileName: item.n,
            fileSize: item.s,
          })),
        },
      };
    } else {
      logger.error("未找到文件信息:", resData);
      throw new Error(resData?.error || "未找到文件信息");
    }
  }

  async getFolderList(parentCid = "0"): Promise<FolderListResponse> {
    const response = await this.api.get("/files", {
      params: {
        aid: 1,
        cid: parentCid,
        o: "user_ptime",
        asc: 1,
        offset: 0,
        show_dir: 1,
        limit: 50,
        type: 0,
        format: "json",
        star: 0,
        suffix: "",
        natsort: 0,
        snap: 0,
        record_open_time: 1,
        fc_mix: 0,
      },
    });
    if (response.data?.state) {
      return {
        data: response.data.data
          .filter((item: Cloud115FolderItem) => item.cid && !!item.ns)
          .map((folder: Cloud115FolderItem) => ({
            cid: folder.cid,
            name: folder.n,
            path: response.data.path,
          })),
      };
    } else {
      logger.error("获取目录列表失败:", response.data.error);
      throw new Error("获取115pan目录列表失败:" + response.data.error);
    }
  }

  async saveSharedFile(params: SaveFileParams): Promise<{ message: string; data: unknown }> {
    const param = new URLSearchParams({
      cid: params.folderId || "",
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      file_id: params.fids?.[0] || "",
    });
    const response = await this.api.post("/share/receive", param.toString());
    logger.info("保存文件:", response.data);
    if (response.data.state) {
      return {
        message: response.data.error,
        data: response.data.data,
      };
    } else {
      logger.error("保存文件失败:", response.data.error);
      throw new Error("保存115pan文件失败:" + response.data.error);
    }
  }
}
