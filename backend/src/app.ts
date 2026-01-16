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

  // 内存缓存：tgUserId -> folderId
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

  /**
   * 核心配置获取逻辑
   * 优先获取数据库中的 Cookie 和 文件夹设置
   */
  private async getUserConfig(tgUserId: number) {
    const setting = await UserSetting.findOne({ 
      where: { userId: tgUserId.toString() } 
    });
    
    if (!setting) return null;

    // 如果内存中没有，则同步一下数据库里的目录设置
    if (!this.userFolders.has(tgUserId) && setting.dataValues.cloud115DirId) {
      this.userFolders.set(tgUserId, setting.dataValues.cloud115DirId);
    }

    return {
      cookie: setting.dataValues.cloud115Cookie,
      folderId: this.userFolders.get(tgUserId) || setting.dataValues.cloud115DirId || "0"
    };
  }

  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { 
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://115.com/?cid=${folderId}`
        },
        timeout: 5000
      });
      return resp.data?.name || resp.data?.file_name || `目录(${folderId})`;
    } catch (e: any) {
      return `目录(${folderId})`;
    }
  }

  private async resolvePathToId(pathStr: string, cookie: string): Promise<string> {
    const folders = pathStr.split('/').map(p => p.trim()).filter(p => p !== "" && p !== "根目录");
    let currentId = "0"; 

    for (const folderName of folders) {
      const listUrl = `https://webapi.115.com/files?aid=1&cid=${currentId}&limit=1000&format=json`;
      const listResp = await axios.get(listUrl, { headers: { 'Cookie': cookie } });
      const fileList = listResp.data?.data || [];
      const target = fileList.find((f: any) => f.n === folderName && f.fid === undefined);

      if (target) {
        currentId = target.cid;
      } else {
        throw new Error(`找不到文件夹: "${folderName}"`);
      }
    }
    return currentId;
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    if (!token) return;
    const bot = new Telegraf(token);

    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'folder', description: '📂 查看当前目录' },
      { command: 'setfolder', description: '✍️ 设置路径或ID' }
    ]);

    // --- 指令：设置目录 ---
    bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      const tgUserId = ctx.from.id;
      if (!input) return ctx.reply("💡 请输入 ID 或 路径，如：/setfolder /电影/4K");

      try {
        const config = await this.getUserConfig(tgUserId);
        if (!config?.cookie) return ctx.reply("❌ 未找到您的 115 Cookie，请先在网页端配置。");

        let folderId = "";
        if (/^\d+$/.test(input)) {
          folderId = input;
        } else {
          const waitMsg = await ctx.reply("⌛ 正在解析路径...");
          folderId = await this.resolvePathToId(input, config.cookie);
          await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
        }

        // 1. 更新内存
        this.userFolders.set(tgUserId, folderId);
        
        // 2. 持久化到数据库 (使用 upsert 确保记录存在)
        await UserSetting.upsert({
          userId: tgUserId.toString(),
          cloud115DirId: folderId,
          cloud115Cookie: config.cookie // 保持原有 cookie
        });

        const realName = await this.getFolderName(folderId, config.cookie);
        ctx.reply(`✅ 设置成功！\n📂 目标：<b>${realName}</b>\n🆔 ID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
      } catch (e: any) {
        ctx.reply(`❌ 失败: ${e.message}`);
      }
    });

    // --- 指令：查看当前目录 ---
    bot.command("folder", async (ctx) => {
      const config = await this.getUserConfig(ctx.from.id);
      if (!config) return ctx.reply("❌ 请先配置 115 Cookie");
      
      const name = await this.getFolderName(config.folderId, config.cookie);
      ctx.reply(`📂 当前转存目录: <b>${name}</b>\n🆔 ID: <code>${config.folderId}</code>`, { parse_mode: 'HTML' });
    });

    // --- 指令：搜索资源 ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词");
      
      const config = await this.getUserConfig(ctx.from.id);
      const loadingMsg = await ctx.reply(`🔍 搜索 "${keyword}"...`);
      
      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((c: any) => c.list || []);
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item: any, index: number) => {
          const shareLink115 = item.cloudLinks?.find((l: string) => /115\.com\/s\//i.test(l));
          responseTxt += `${index + 1}. ${shareLink115 ? "🔵" : "⚪"} <b>${item.title}</b>\n\n`;
          
          if (shareLink115) {
            const url = new URL(shareLink115);
            const sc = url.pathname.split('/').filter(p => p && p !== 's').pop() || "";
            const pc = url.searchParams.get("password") || "";
            currentRow.push(Markup.button.callback(`${index + 1} (存)`, `sv|${sc}|${pc}`));
          }

          if (currentRow.length === 5 || index === topItems.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
          }
        });

        const folderName = config ? await this.getFolderName(config.folderId, config.cookie) : "未设置";
        responseTxt += `--- --- --- --- ---\n📂 存至: <b>${folderName}</b>`;
        
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        ctx.reply("❌ 搜索出错");
      }
    });

    // --- 回调：执行转存 ---
    bot.action(/^sv\|(.+?)\|(.+?)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      try {
        const config = await this.getUserConfig(ctx.from!.id);
        if (!config?.cookie) throw new Error("请先登录");

        await ctx.answerCbQuery(`🚀 正在转存至 ${config.folderId}...`);
        
        (this.cloud115Service as any).cookie = config.cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        
        // 获取分享链接内所有文件 ID 实现全选转存
        const fids = shareInfo.data.list.map((f: any) => f.fileId);
        if (!fids.length) throw new Error("资源包为空");

        await this.cloud115Service.saveSharedFile({
          shareCode: sc, receiveCode: pc, fids: fids, folderId: config.folderId
        });

        await ctx.reply(`✅ 转存成功！\n📦 资源：${shareInfo.data.share_title}\n共 ${fids.length} 个文件`);
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
      this.app.listen(port, () => logger.info(`🚀 Server running on ${port}`));
    } catch (error) {
      logger.error("启动失败", error);
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
