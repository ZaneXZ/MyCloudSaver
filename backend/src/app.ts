// @ts-ignore
if (typeof File === 'undefined') {
  global.File = class File extends Blob {
    name: string;
    lastModified: number = Date.now();
    constructor(chunks: any[], name: string, opts?: any) {
      super(chunks, opts);
      this.name = name;
    }
  } as any;
}

import "./types/express";
import express from "express";
import { container } from "./inversify.config";
import { TYPES } from "./core/types";
import { DatabaseService } from "./services/DatabaseService";
import { setupMiddlewares } from "./middleware";
import routes from "./routes/api";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";
import axios from "axios";

import { Telegraf, Markup } from "telegraf";
import { Searcher } from "./services/Searcher";
import { Cloud115Service } from "./services/Cloud115Service";
import UserSetting from "./models/UserSetting";

class App {
  private app = express();
  private databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
  private searcher = container.get<Searcher>(TYPES.Searcher);
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service);

  private userFolders = new Map<number, string>();

  constructor() {
    this.setupExpress();
    this.setupTelegramBot();
  }

  private setupExpress(): void {
    setupMiddlewares(this.app);
    this.app.use("/", routes);
    this.app.use(errorHandler);
  }

  // --- 工具方法：获取 115 Cookie ---
  private async get115Cookie(adminUserId: string): Promise<string | null> {
    logger.info(`[Debug] 机器人正在尝试获取用户 ID 为 ${adminUserId} 的 Cookie...`);
    const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
    if (!userSetting) {
        logger.warn(`[Debug] 数据库中找不到用户 ${adminUserId} 的设置记录`);
        return null;
    }
    const cookie = userSetting.dataValues.cloud115Cookie;
    if (!cookie) {
        logger.warn(`[Debug] 用户 ${adminUserId} 的 115 Cookie 为空，请去网页端登录`);
    }
    return cookie || null;
  }

  // --- 工具方法：通过 ID 获取文件夹名称 ---
  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0") return "根目录";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { Cookie: cookie }
      });
      return resp.data?.name || `未知目录(${folderId})`;
    } catch (e) {
      return `未知目录(${folderId})`;
    }
  }

  // --- 工具方法：通过路径解析或创建文件夹 ID ---
  private async resolvePathToId(pathStr: string, cookie: string): Promise<string> {
    const folders = pathStr.split('/').filter(p => p.trim() !== "");
    let currentId = "0"; // 从根目录开始

    for (const folderName of folders) {
      // 1. 在当前 ID 下查找是否存在该文件夹
      const listUrl = `https://webapi.115.com/files?aid=1&cid=${currentId}&o=user_ptime&asc=0&offset=0&limit=1000&block=&format=json`;
      const listResp = await axios.get(listUrl, { headers: { Cookie: cookie } });
      const target = listResp.data?.data?.find((f: any) => f.n === folderName && f.fid === undefined); // fid不存在说明是文件夹

      if (target) {
        currentId = target.cid;
      } else {
        // 2. 如果不存在，则创建它
        const createUrl = "https://webapi.115.com/files/add";
        const params = new URLSearchParams();
        params.append("pid", currentId);
        params.append("name", folderName);
        const createResp = await axios.post(createUrl, params, { headers: { Cookie: cookie } });
        if (createResp.data?.state) {
          currentId = createResp.data.cid;
        } else {
          throw new Error(`无法创建文件夹: ${folderName}`);
        }
      }
    }
    return currentId;
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "1";
    if (!token) return;

    const bot = new Telegraf(token);

    // --- 命令: 路径/ID 修改 ---
    bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input) return ctx.reply("💡 用法:\n1. 纯ID: /setfolder 123\n2. 路径: /setfolder /电影/4K");

      const cookie = await this.get115Cookie(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先在网页端登录 115");

      try {
        let folderId = "";
        if (/^\d+$/.test(input)) {
          folderId = input;
        } else {
          const waitMsg = await ctx.reply("⏳ 正在同步 115 目录结构...");
          folderId = await this.resolvePathToId(input, cookie);
          await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
        }

        this.userFolders.set(ctx.from.id, folderId);
        const folderName = await this.getFolderName(folderId, cookie);
        ctx.reply(`✅ 设置成功！\n📂 目标路径: <b>${input}</b>\n🆔 文件夹ID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
      } catch (e: any) {
        ctx.reply(`❌ 设置失败: ${e.message}`);
      }
    });

    // --- 命令: 查询当前路径 ---
    bot.command("folder", async (ctx) => {
      const cookie = await this.get115Cookie(adminUserId);
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : folderId;
      ctx.reply(`📂 当前转存位置: <b>${folderName}</b>\n🆔 ID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    // --- 命令: 搜索资源 ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 使用方法：/search 关键词");

      const loadingMsg = await ctx.reply(`🔍 正在检索 "${keyword}"...`);
      const cookie = await this.get115Cookie(adminUserId);
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : folderId;

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = result.data?.flatMap(channel => channel.list) || [];
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item, index) => {
          const shareLink115 = item.cloudLinks?.find((l: string) => /https?:\/\/(?:115|anxia|115cdn|115\.me)\.com?\/s\//i.test(l));
          const typeIcon = shareLink115 ? "🔵" : "⚪";
          responseTxt += `${index + 1}. ${typeIcon} <b>${item.title}</b>\n   来源: ${item.channel}\n\n`;
          
          if (shareLink115) {
            const url = new URL(shareLink115);
            const sc = url.pathname.split('/').filter(p => p && p !== 's').pop() || "";
            const pc = url.searchParams.get("password") || "";
            currentRow.push(Markup.button.callback(`${index + 1} (存)`, `sv|${sc}|${pc}|${index + 1}`));
          } else if (item.cloudLinks?.[0]) {
            currentRow.push(Markup.button.url(`${index + 1} (看)`, item.cloudLinks[0]));
          }

          if (currentRow.length === 5 || index === topItems.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
          }
        });

        responseTxt += `📂 转存目录: <b>${folderName}</b>`;
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        ctx.reply("❌ 搜索失败");
      }
    });

    // 按钮回调
    bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc, idx] = ctx.match;
      const folderId = this.userFolders.get(ctx.from!.id) || "0";
      try {
        await ctx.answerCbQuery(`正在转存...`);
        const cookie = await this.get115Cookie(adminUserId);
        if (!cookie) return ctx.reply("❌ 请先登录 115");
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const firstFile = shareInfo.data.list[0];
        if (!firstFile) throw new Error("链接失效");

        await this.cloud115Service.saveSharedFile({
          shareCode: sc, receiveCode: pc, fids: [firstFile.fileId], folderId: folderId
        });
        await ctx.reply(`✅ 转存成功！\n📦 ${firstFile.fileName}`);
      } catch (err: any) {
        await ctx.reply(`❌ 失败: ${err.message}`);
      }
    });

    bot.launch();
    logger.info("🤖 115 助手已升级：支持路径识别与创建");
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => logger.info(`🚀 Server listening on ${port}`));
    } catch (error) {
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
