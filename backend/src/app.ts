// @ts-ignore
/**
 * Node.js v18+ 兼容性补丁
 */
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

  // 内存存储：用户 ID 对应的当前 TargetFolderID
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
    const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return userSetting?.dataValues.cloud115Cookie || null;
  }

  // --- 工具方法：通过 ID 获取文件夹名称 ---
  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { 
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/115.0.0.0 Safari/537.36',
          'Referer': 'https://115.com/'
        }
      });
      return resp.data?.name || `目录(${folderId})`;
    } catch (e) {
      return `目录(${folderId})`;
    }
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || ""; 

    if (!token) {
      logger.warn("⚠️ TG_BOT_TOKEN 未设置，机器人将无法启动");
      return;
    }

    const bot = new Telegraf(token);

    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'folder', description: '📂 查看当前目录' },
      { command: 'setfolder', description: '✍️ 设置转存路径 ID' }
    ]);

    // --- 修改转存路径 ---
    bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input || !/^\d+$/.test(input)) return ctx.reply("💡 请输入纯数字的文件夹 ID。例: /setfolder 123456789");

      const cookie = await this.get115Cookie(adminUserId);
      const folderName = cookie ? await this.getFolderName(input, cookie) : "未知";

      this.userFolders.set(ctx.from.id, input);
      ctx.reply(`✅ 路径设置成功！\n📂 目标：<b>${folderName}</b>\n🆔 ID：<code>${input}</code>`, { parse_mode: 'HTML' });
    });

    // --- 查询当前路径 ---
    bot.command("folder", async (ctx) => {
      const cookie = await this.get115Cookie(adminUserId);
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      const name = cookie ? await this.getFolderName(folderId, cookie) : folderId;
      ctx.reply(`📂 当前转存目录: <b>${name}</b>\n🆔 ID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    // --- 搜索资源 (包含路径实时回显) ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词，例如：/search 庆余年");

      const loadingMsg = await ctx.reply(`🔍 正在检索 "${keyword}"...`);
      
      try {
        const cookie = await this.get115Cookie(adminUserId);
        const folderId = this.userFolders.get(ctx.from.id) || "0";
        const folderName = cookie ? await this.getFolderName(folderId, cookie) : "根目录";

        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((channel: any) => channel.list || []);
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");
        }

        let responseTxt = `🔍 <b>"${keyword}"</b> 搜索结果:\n\n`;
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item: any, index: number) => {
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

        responseTxt += `--- --- --- --- ---\n`;
        responseTxt += `📂 转存至: <b>${folderName}</b>\n`;
        responseTxt += `🆔 目录ID: <code>${folderId}</code>`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        logger.error("搜索失败:", err);
        ctx.reply("❌ 搜索失败，请稍后重试");
      }
    });

    // --- 转存执行 ---
    bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc, idx] = ctx.match;
      const folderId = this.userFolders.get(ctx.from!.id) || "0";
      try {
        await ctx.answerCbQuery(`🚀 正在发起转存...`);
        const cookie = await this.get115Cookie(adminUserId);
        if (!cookie) return ctx.reply("❌ 请在网页端登录 115");

        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const firstFile = shareInfo.data.list[0];
        if (!firstFile) throw new Error("资源已过期");

        await this.cloud115Service.saveSharedFile({
          shareCode: sc, receiveCode: pc, fids: [firstFile.fileId], folderId: folderId
        });
        await ctx.reply(`✅ 转存成功！\n📦 ${firstFile.fileName}`);
      } catch (err: any) {
        await ctx.reply(`❌ 失败: ${err.message}`);
      }
    });

    bot.launch();
    logger.info("🤖 机器人启动成功");
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => logger.info(`🚀 Server listening on ${port}`));
    } catch (error) {
      logger.error("启动失败:", error);
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
