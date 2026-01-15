import { defineStore } from "pinia";
import { cloud115Api } from "@/api/cloud115";
import { resourceApi } from "@/api/resource";
import { quarkApi } from "@/api/quark";
import type {
  Resource,
  ShareInfoResponse,
  ShareInfo,
  ResourceItem,
  GetShareInfoParams,
  SaveFileParams,
  ShareFileInfoAndFolder,
} from "@/types";
import { ElMessage } from "element-plus";

interface StorageListObject {
  list: Resource[];
  lastUpdateTime?: string;
}

const lastResource = (
  localStorage.getItem("last_resource_list")
    ? JSON.parse(localStorage.getItem("last_resource_list") as string)
    : { list: [] }
) as StorageListObject;

// 定义云盘驱动配置类型
interface CloudDriveConfig {
  name: string;
  type: string;
  regex: RegExp;
  api: {
    getShareInfo: (params: GetShareInfoParams) => Promise<ShareInfoResponse>;
    saveFile: (params: SaveFileParams) => Promise<{ code: number; message?: string }>;
  };
  parseShareCode: (match: RegExpMatchArray) => GetShareInfoParams;
  getSaveParams: (shareInfoAndFolder: ShareFileInfoAndFolder) => SaveFileParams;
}

// 云盘类型配置
export const CLOUD_DRIVES: CloudDriveConfig[] = [
  {
    name: "115网盘",
    type: "pan115",
    regex: /(?:115|anxia|115cdn)\.com\/s\/([^?]+)(?:\?password=([^&#]+))?/,
    api: {
      getShareInfo: (params: GetShareInfoParams) => cloud115Api.getShareInfo(params),
      saveFile: async (params: SaveFileParams) => {
        return await cloud115Api.saveFile(params);
      },
    },
    parseShareCode: (match: RegExpMatchArray) => ({
      shareCode: match[1],
      receiveCode: match[2] || "",
    }),
    getSaveParams: (shareInfoAndFolder: ShareFileInfoAndFolder) => ({
      shareCode: shareInfoAndFolder.shareCode || "",
      receiveCode: shareInfoAndFolder.receiveCode || "",
      fileId: shareInfoAndFolder.shareInfo.list[0].fileId,
      folderId: shareInfoAndFolder.folderId,
      fids: shareInfoAndFolder.shareInfo.list.map((item: { fileId?: string }) => item.fileId || ""),
    }),
  },
  {
    name: "夸克网盘",
    type: "quark",
    regex: /pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/,
    api: {
      getShareInfo: (params) => quarkApi.getShareInfo(params),
      saveFile: async (params: SaveFileParams) => {
        return await quarkApi.saveFile(params);
      },
    },
    parseShareCode: (match: RegExpMatchArray) => ({ shareCode: match[1] }),
    getSaveParams: (shareInfoAndFolder: ShareFileInfoAndFolder) => ({
      fids: shareInfoAndFolder.shareInfo.list.map((item: { fileId?: string }) => item.fileId || ""),
      fidTokens: shareInfoAndFolder.shareInfo.list.map(
        (item: { fileIdToken?: string }) => item.fileIdToken || ""
      ),
      folderId: shareInfoAndFolder.folderId,
      shareCode: shareInfoAndFolder.shareInfo.pwdId || "",
      receiveCode: shareInfoAndFolder.shareInfo.stoken || "",
    }),
  },
];

export const useResourceStore = defineStore("resource", {
  state: () => ({
    tagColor: {
      baiduPan: "primary",
      weiyun: "info",
      aliyun: "warning",
      pan115: "danger",
      quark: "success",
    },
    keyword: "",
    resources: lastResource.list,
    lastUpdateTime: lastResource.lastUpdateTime || "",
    shareInfo: {} as ShareInfoResponse,
    resourceSelect: [] as ShareInfo[],
    loading: false,
    backupPlan: false,
    loadTree: false,
  }),

  actions: {
    setLoadTree(loadTree: boolean) {
      this.loadTree = loadTree;
    },
    // 搜索资源
    async searchResources(keyword?: string, isLoadMore = false, channelId?: string): Promise<void> {
      this.loading = true;
      if (!isLoadMore) this.resources = [];
      try {
        let lastMessageId = "";
        if (isLoadMore) {
          const list = this.resources.find((x) => x.id === channelId)?.list || [];
          lastMessageId = list[list.length - 1].messageId || "";
          if (list[list.length - 1].isLastMessage) {
            ElMessage.warning("没有更多了~");
            return;
          }
          if (!lastMessageId) {
            ElMessage.error("当次搜索源不支持加载更多");
            return;
          }
          keyword = this.keyword;
        }
        let { data = [] } = await resourceApi.search(keyword || "", channelId, lastMessageId);
        this.keyword = keyword || "";
        data = data
          .filter((item) => item.list.length > 0)
          .map((x) => ({
            ...x,
            list: x.list.map((item) => ({
              ...item,
              isSupportSave: CLOUD_DRIVES.some((drive) => drive.regex.test(item.cloudLinks[0])),
            })),
          }));
        console.log(data);
        if (isLoadMore) {
          const findedIndex = this.resources.findIndex((item) => item.id === data[0]?.id);
          if (findedIndex !== -1) {
            this.resources[findedIndex].list.push(...data[0].list);
          }
          if (data.length === 0) {
            const list = this.resources.find((item) => item.id === channelId)?.list;
            list && list[list.length - 1] && (list[list.length - 1]!.isLastMessage = true);
            ElMessage.warning("没有更多了~");
          }
        } else {
          this.resources = data.map((item, index) => ({ ...item, displayList: index === 0 }));
          if (!keyword) {
            // 获取当前时间字符串 用于存储到本地
            this.lastUpdateTime = new Date().toLocaleString();
            localStorage.setItem(
              "last_resource_list",
              JSON.stringify({ list: this.resources, lastUpdateTime: this.lastUpdateTime })
            );
          }
          if (this.resources.length === 0) {
            ElMessage.warning("未搜索到相关资源");
          }
        }
      } catch (error) {
        console.log(error);
        this.handleError("搜索失败，请重试", null);
      } finally {
        this.loading = false;
      }
    },

    // 设置选择资源
    async setSelectedResource(resourceSelect: ShareInfo[]) {
      this.resourceSelect = resourceSelect;
    },

    // 转存资源
    async saveResource(resource: ResourceItem, folderId: string): Promise<void> {
      const savePromises: Promise<void>[] = [];
      CLOUD_DRIVES.forEach((drive) => {
        if (resource.cloudLinks.some((link) => drive.regex.test(link))) {
          savePromises.push(this.saveResourceToDrive(resource, folderId, drive));
        }
      });
      await Promise.all(savePromises);
    },

    // 保存资源到网盘
    async saveResourceToDrive(
      resource: ResourceItem,
      folderId: string,
      drive: CloudDriveConfig
    ): Promise<void> {
      const link = resource.cloudLinks.find((link) => drive.regex.test(link));
      if (!link) return;

      const match = link.match(drive.regex);
      if (!match) throw new Error("链接解析失败");
      const parsedCode = drive.parseShareCode(match);

      const shareInfo = {
        ...this.shareInfo,
        list: this.resourceSelect.filter((x) => x.isChecked),
      };
      console.log(shareInfo);

      const params = drive.getSaveParams({
        shareInfo,
        ...parsedCode,
        folderId,
      });
      const result = await drive.api.saveFile(params);

      if (result.code === 0) {
        ElMessage.success(`${drive.name} 转存成功`);
      } else {
        ElMessage.error(result.message);
      }
    },

    // 解析云盘链接
    async parsingCloudLink(url: string): Promise<void> {
      this.loading = true;
      this.resources = [];
      try {
        const matchedDrive = CLOUD_DRIVES.find((drive) => drive.regex.test(url));
        if (!matchedDrive) throw new Error("不支持的网盘链接");

        const match = url.match(matchedDrive.regex);
        if (!match) throw new Error("链接解析失败");

        const parsedCode = matchedDrive.parseShareCode(match);
        const shareInfo = await matchedDrive.api.getShareInfo(parsedCode);
        if (shareInfo?.list?.length) {
          this.resources = [
            {
              id: "",
              channelInfo: {
                name: "自定义搜索",
                channelLogo: "",
                channelId: "",
              },
              displayList: true,
              list: [
                {
                  id: "1",
                  title: shareInfo.list.map((item) => item.fileName).join(", "),
                  cloudLinks: [url],
                  cloudType: matchedDrive.type,
                  channel: matchedDrive.name,
                  pubDate: "",
                  isSupportSave: true,
                },
              ],
            },
          ];
        } else {
          throw new Error("解析失败，请检查链接是否正确");
        }
      } catch (error) {
        this.handleError("解析失败，请重试", error);
      } finally {
        this.loading = false;
      }
    },

    // 获取资源列表并选择
    async getResourceListAndSelect(resource: ResourceItem): Promise<boolean> {
      this.setSelectedResource([]);
      const { cloudType } = resource;
      const drive = CLOUD_DRIVES.find((x) => x.type === cloudType);
      if (!drive) {
        return false;
      }
      const link = resource.cloudLinks.find((link) => drive.regex.test(link));
      if (!link) return false;

      const match = link.match(drive.regex);
      if (!match) throw new Error("链接解析失败");

      const parsedCode = drive.parseShareCode(match);
      this.setLoadTree(true);
      let shareInfo = await drive.api.getShareInfo(parsedCode);
      console.log(shareInfo);
      this.setLoadTree(false);
      if (shareInfo) {
        shareInfo = {
          ...shareInfo,
          ...parsedCode,
        };
        this.shareInfo = shareInfo;
        this.setSelectedResource(this.shareInfo.list.map((x) => ({ ...x, isChecked: true })));
        return true;
      } else {
        ElMessage.error("获取资源信息失败,请先检查cookie!");
        return false;
      }
    },

    // 统一错误处理
    handleError(message: string, error: unknown): void {
      console.error(message, error);
      ElMessage.error(error instanceof Error ? error.message : message);
    },
  },
});
