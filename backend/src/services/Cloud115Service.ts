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
  public cookie: string = ""; // 改为 public 方便 app.ts 直接赋值

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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        Referer: "https://115.com/",
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

  async getShareInfo(shareCode: string, receiveCode = ""): Promise<ShareInfoResponse> {
    const response = await this.api.get("/share/snap", {
      params: {
        share_code: shareCode,
        receive_code: receiveCode,
        offset: 0,
        limit: 20,
        cid: "",
      },
    });

    const resData = response.data;
    if (resData?.state && resData.data?.list?.length > 0) {
      return {
        data: {
          // 核心修复：添加 share_title 字段，解决编译报错
          share_title: resData.data.share_title || resData.data.title || "未知分享资源",
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
    // 增强：将 fids 数组转为逗号分隔的字符串，支持批量转存
    const fileIds = Array.isArray(params.fids) ? params.fids.join(",") : params.fids;

    const param = new URLSearchParams({
      cid: params.folderId || "0",
      share_code: params.shareCode || "",
      receive_code: params.receiveCode || "",
      file_id: fileIds || "",
    });

    const response = await this.api.post("/share/receive", param.toString());
    
    if (response.data.state) {
      return {
        message: response.data.error || "保存成功",
        data: response.data.data,
      };
    } else {
      logger.error("保存文件失败:", response.data.error);
      throw new Error(response.data.error || "保存115pan文件失败");
    }
  }
}
