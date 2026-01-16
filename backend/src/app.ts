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

  private async get115Cookie(adminUserId: string): Promise<string | null> {
    const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return userSetting?.dataValues.cloud115Cookie || null;
  }

// --- 增强版：通过 ID 获取文件夹真实名称 ---
private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    try {
      // 尝试使用更详细的目录查询接口
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { 
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://115.com/?cid=${folderId}&offset=0&mode=wangpan`
        }
      });

      // 115 的 API 可能会把名字放在这几个字段中的任何一个
      const data = resp.data;
      const folderName = data.name || data.file_name || data.n || (data.data && data.data[0] ? data.data[0].n : null);
      
      if (folderName) {
        return folderName;
      }

      // 如果上述都没找到，尝试第二个备用接口 (category/get)
      const backupResp = await axios.get(`https://webapi.115.com/category/get?cid=${folderId}`, {
        headers: { 'Cookie': cookie, 'Referer': 'https://115.com/' }
      });
      
      if (backupResp.data && backupResp.data.data && backupResp.data.data.file_name) {
        return backupResp.data.data.file_name;
      }

      return `目录(${folderId})`; 
    } catch (e: any) {
      logger.error(`查询 ID ${folderId} 失败: ${e.message}`);
      return `目录(${folderId})`;
    }
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || ""; 

    if (!token) return;
    const bot = new Telegraf(token);

    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'folder', description: '📂 查看当前目录' },
      { command: 'setfolder', description: '✍️ 设置路径或ID' }
    ]);

    bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input) return ctx.reply("💡 请输入文件夹 ID 或 路径。\n例1: /setfolder 123456\n例2: /setfolder /我的视频/电影");

      const cookie = await this.get115Cookie(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先在网页端登录 115");

      try {
        let folderId = "";
        if (/^\d+$/.test(input)) {
          // 如果是纯数字，直接作为 ID
          folderId = input;
        } else {
          // 如果是路径，递归查找
          const waitMsg = await ctx.reply("⌛ 正在查询 115 目录...");
          folderId = await this.resolvePathToId(input, cookie);
          await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
        }

        const realName = await this.getFolderName(folderId, cookie);
        this.userFolders.set(ctx.from.id, folderId);
        ctx.reply(`✅ 设置成功！\n📂 目标：<b>${realName}</b>\n🆔 ID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
      } catch (e: any) {
        ctx.reply(`❌ 设置失败: ${e.message}`);
      }
    });

    bot.command("folder", async (ctx) => {
      const cookie = await this.get115Cookie(adminUserId);
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      const name = cookie ? await this.getFolderName(folderId, cookie) : folderId;
      ctx.reply(`📂 当前目录: <b>${name}</b>\n🆔 ID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词");
      const loadingMsg = await ctx.reply(`🔍 搜索 "${keyword}"...`);
      
      try {
        const cookie = await this.get115Cookie(adminUserId);
        const folderId = this.userFolders.get(ctx.from.id) || "0";
        const folderName = cookie ? await this.getFolderName(folderId, cookie) : "根目录";

        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((c: any) => c.list || []);
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item: any, index: number) => {
          const shareLink115 = item.cloudLinks?.find((l: string) => /https?:\/\/(?:115|anxia|115cdn|115\.me)\.com?\/s\//i.test(l));
          responseTxt += `${index + 1}. ${shareLink115 ? "🔵" : "⚪"} <b>${item.title}</b>\n   来源: ${item.channel}\n\n`;
          
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

        responseTxt += `--- --- --- --- ---\n📂 转存至: <b>${folderName}</b>\n🆔 目录ID: <code>${folderId}</code>`;
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        ctx.reply("❌ 搜索失败");
      }
    });

    bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const folderId = this.userFolders.get(ctx.from!.id) || "0";
      try {
        await ctx.answerCbQuery(`🚀 转存中...`);
        const cookie = await this.get115Cookie(adminUserId);
        if (!cookie) return ctx.reply("❌ 请登录");
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
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => logger.info(`🚀 Server on ${port}`));
    } catch (error) {
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
