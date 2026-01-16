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
import MonitorTask from "./models/MonitorTask";

class App {
  private app = express();
  private databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
  private searcher = container.get<Searcher>(TYPES.Searcher);
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service);
  private bot!: Telegraf;

  constructor() {
    this.setupExpress();
    this.setupTelegramBot();
    this.setupAutoMonitor();
  }

  private setupExpress(): void {
    setupMiddlewares(this.app);
    this.app.use("/", routes);
    this.app.use(errorHandler);
  }

  // --- 从数据库获取用户配置 ---
  private async getUserConfig(adminUserId: string) {
    const setting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return {
      cookie: setting?.dataValues.cloud115Cookie || null,
      folderId: setting?.dataValues.folderId || "0"
    };
  }

  // --- 获取 115 文件夹名称 ---
  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    const headers = { 
      'Cookie': cookie, 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `https://115.com/?cid=${folderId}&mode=wangpan` 
    };
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, { headers });
      return resp.data?.name || resp.data?.file_name || `目录(${folderId})`;
    } catch { return `目录(${folderId})`; }
  }

  // --- 自动化追更扫描任务 ---
  private setupAutoMonitor() {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    setInterval(async () => {
      logger.info("🔄 [定时任务] 开始扫描数据库中的追更任务...");
      const adminUserId = process.env.ADMIN_USER_ID || "";
      const { cookie } = await this.getUserConfig(adminUserId);
      if (!cookie) return;

      const tasks = await MonitorTask.findAll();
      for (const task of tasks) {
        try {
          (this.cloud115Service as any).cookie = cookie;
          const shareInfo = await this.cloud115Service.getShareInfo(task.shareCode, task.receiveCode);
          const currentFiles = shareInfo.data.list || [];
          const processedFids = new Set<string>(JSON.parse(task.processedFids));
          const newFiles = currentFiles.filter((f: any) => !processedFids.has(f.fileId));

          if (newFiles.length > 0) {
            await this.cloud115Service.saveSharedFile({
              shareCode: task.shareCode, 
              receiveCode: task.receiveCode,
              fids: newFiles.map((f: any) => f.fileId), 
              folderId: task.folderId
            });
            newFiles.forEach((f: any) => processedFids.add(f.fileId));
            task.processedFids = JSON.stringify(Array.from(processedFids));
            await task.save();

            await this.bot.telegram.sendMessage(task.chatId, 
              `🔔 <b>追更通知</b>\n📦 资源：${task.title}\n✨ 检测到 ${newFiles.length} 个新文件已自动存入。`,
              { parse_mode: 'HTML' }
            );
          }
        } catch (err: any) {
          logger.error(`[追更异常] ${task.title}: ${err.message}`);
        }
      }
    }, TWELVE_HOURS);
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;

    this.bot = new Telegraf(token);
    this.bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'tasks', description: '📋 追更列表/取消' },
      { command: 'folder', description: '📂 当前目录' },
      { command: 'setfolder', description: '✍️ 设置路径' }
    ]);

    // --- 目录查询 ---
    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先配置 115 Cookie");
      const folderName = await this.getFolderName(folderId, cookie);
      ctx.reply(`📂 <b>当前转存目录：</b>\n\n名称：${folderName}\nID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    // --- 设置目录 ---
    this.bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload;
      if (!folderId) return ctx.reply("💡 请输入 ID：/setfolder 12345");
      const [setting] = await UserSetting.findOrCreate({ where: { userId: adminUserId } });
      await setting.update({ folderId });
      const { cookie } = await this.getUserConfig(adminUserId);
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "设置成功";
      ctx.reply(`✅ <b>目录已保存</b>\n\n新目录：${folderName}`, { parse_mode: 'HTML' });
    });

    // --- 任务列表 ---
    this.bot.command("tasks", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (tasks.length === 0) return ctx.reply("📋 目前没有追更任务。");
      await ctx.reply("📋 <b>追更列表：</b>", { parse_mode: 'HTML' });
      for (const t of tasks) {
        await ctx.reply(`📦 <b>${t.title}</b>`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([Markup.button.callback("❌ 取消追更", `unmt|${t.shareCode}`)])
        });
      }
    });

    // --- 核心搜索逻辑 ---
    this.bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词");
      const loadingMsg = await ctx.reply(`🔍 正在搜索 "${keyword}"...`);
      
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "根目录";

      try {
        const result = await this.searcher.searchAll(keyword);
        
        // 1. 注入频道名称并扁平化
        const allItems = (result.data || []).flatMap((sourceGroup: any) => {
          const sourceName = sourceGroup.title || sourceGroup.name || sourceGroup.source || "未知频道";
          return (sourceGroup.list || []).map((item: any) => ({
            ...item,
            sourceName
          }));
        });

        const topItems = allItems.slice(0, 8); 

        if (topItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到相关资源。");
        }

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];

        topItems.forEach((item: any, index: number) => {
          const num = index + 1;
          const shareLink = (item.cloudLinks || []).find((l: string) => 
            /115\.com\/s\//i.test(l) || /anxia\.com\/s\//i.test(l)
          );
          
          responseTxt += `${num}. <b>${item.title}</b>\n`;
          responseTxt += `📺 来源：<code>${item.sourceName}</code>\n\n`;

          if (shareLink) {
            const cleanLink = shareLink.trim().replace(/\/$/, ""); 
            const scMatch = cleanLink.match(/\/s\/([a-zA-Z0-9]+)/);
            const sc = scMatch ? scMatch[1] : "";
            
            let pc = "";
            try { 
                const urlObj = new URL(cleanLink);
                pc = urlObj.searchParams.get("password") || "";
            } catch(e) {}

            if (sc) {
              keyboard.push([
                Markup.button.callback(`📥 转存 #${num}`, `sv|${sc}|${pc}|${index}`),
                Markup.button.callback(`🔔 追更 #${num}`, `mt|${sc}|${pc}|${index}`)
              ]);
            }
          }
        });

        responseTxt += `--- --- --- --- ---\n📂 目标: <b>${folderName}</b>`;
        
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard) 
        });
      } catch (err) {
        logger.error("搜索失败:", err);
        ctx.reply("❌ 搜索失败");
      }
    });

    // --- 取消追更回调 ---
    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      const sc = ctx.match[1];
      const deleted = await MonitorTask.destroy({ where: { shareCode: sc } });
      if (deleted) await ctx.editMessageText(`❌ <b>已取消追更</b>`, { parse_mode: 'HTML' });
    });

    // --- 开启追更回调 ---
    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        
        const list = shareInfo?.data?.list || [];
        if (list.length === 0) throw new Error("未找到文件列表");

        const shareTitle = shareInfo.data.share_title || "未命名";
        const [task, created] = await MonitorTask.findOrCreate({
          where: { shareCode: sc },
          defaults: {
            title: shareTitle, receiveCode: pc, folderId,
            processedFids: JSON.stringify(list.map((f: any) => f.fileId)),
            chatId: ctx.chat!.id
          }
        });
        ctx.reply(created ? `✅ <b>追更已开启</b>\n📦 ${shareTitle}` : "⚠️ 已在监控中", { parse_mode: 'HTML' });
      } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
    });

    // --- 立即转存回调 ---
    this.bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        
        const fids = (shareInfo?.data?.list || []).map((f: any) => f.fileId);
        if (fids.length === 0) throw new Error("未找到文件信息");

        await this.cloud115Service.saveSharedFile({ 
            shareCode: sc, receiveCode: pc, 
            fids: fids, 
            folderId 
        });
        ctx.reply(`✅ 转存完成`);
      } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
    });

    this.bot.launch();
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true });
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009, () => {
        logger.info(`🚀 Server started on port ${process.env.PORT || 8009}`);
      });
    } catch (error) { 
      logger.error("启动失败:", error);
      process.exit(1); 
    }
  }
}

const application = new App();
application.start();
export default application;
