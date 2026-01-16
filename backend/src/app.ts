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

  // --- 增强版：双接口查询目录名称 ---
  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    const headers = { 
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `https://115.com/?cid=${folderId}&mode=wangpan`
    };

    try {
      // 接口 1: getid
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, { headers });
      const n1 = resp.data?.name || resp.data?.file_name;
      if (n1) return n1;

      // 接口 2: category/get
      const resp2 = await axios.get(`https://webapi.115.com/category/get?cid=${folderId}`, { headers });
      const n2 = resp2.data?.data?.file_name || resp2.data?.data?.name;
      if (n2) return n2;

      return `目录(${folderId})`;
    } catch (e) {
      return `目录(${folderId})`;
    }
  }

  // --- 路径解析逻辑 (修复缺失的方法) ---
  private async resolvePathToId(pathStr: string, cookie: string): Promise<string> {
    const folders = pathStr.split('/')
        .map(p => p.trim())
        .filter(p => p !== "" && p !== "根目录" && p !== "首页");
        
    let currentId = "0"; 
    const headers = { 
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://115.com/'
    };

    for (const folderName of folders) {
      const listUrl = `https://webapi.115.com/files?aid=1&cid=${currentId}&o=user_ptime&asc=0&offset=0&limit=1000&format=json`;
      const listResp = await axios.get(listUrl, { headers });
      const fileList = listResp.data?.data || listResp.data?.list || [];
      const target = fileList.find((f: any) => f.n === folderName && (f.fid === undefined || f.p === undefined));

      if (target) {
        currentId = target.cid;
      } else {
        throw new Error(`找不到 "${folderName}"，请确保已手动创建`);
      }
    }
    return currentId;
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || ""; 

    if (!token) return;
    const bot = new Telegraf(token);

    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'folder', description: '📂 当前目录' },
      { command: 'setfolder', description: '✍️ 设置路径或ID' }
    ]);

    bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input) return ctx.reply("💡 请输入 ID 或路径。例: /setfolder /电视剧");

      const cookie = await this.get115Cookie(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先登录 115");

      try {
        let folderId = "";
        if (/^\d+$/.test(input)) {
          folderId = input;
        } else {
          const waitMsg = await ctx.reply("⌛ 正在解析路径...");
          folderId = await this.resolvePathToId(input, cookie);
          await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
        }

        const realName = await this.getFolderName(folderId, cookie);
        this.userFolders.set(ctx.from.id, folderId);
        ctx.reply(`✅ 设置成功！\n📂 目标：<b>${realName}</b>\n🆔 ID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
      } catch (e: any) {
        ctx.reply(`❌ 失败: ${e.message}`);
      }
    });

    bot.command("folder", async (ctx) => {
      const cookie = await this.get115Cookie(adminUserId);
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      const name = cookie ? await this.getFolderName(folderId, cookie) : folderId;
      ctx.reply(`📂 当前转存目录: <b>${name}</b>\n🆔 ID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
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
            currentRow.push(Markup.button.callback(`${index + 1}`, `sv|${sc}|${pc}|${index + 1}`));
          }

          if (currentRow.length === 5 || index === topItems.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
          }
        });

        responseTxt += `--- --- --- --- ---\n📂 转存至: <b>${folderName}</b>\n🆔 ID: <code>${folderId}</code>`;
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
        if (!cookie) return;
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const f = shareInfo.data.list[0];
        await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids: [f.fileId], folderId });
        await ctx.reply(`✅ 转存成功！\n📦 ${f.fileName}`);
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
      this.app.listen(process.env.PORT || 8009, () => logger.info(`🚀 Server ready`));
    } catch (error) {
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
