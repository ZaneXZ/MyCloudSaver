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

  // --- 核心：从数据库获取用户配置（Cookie 和 FolderId） ---
  private async getUserConfig(adminUserId: string) {
    const setting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return {
      cookie: setting?.dataValues.cloud115Cookie || null,
      folderId: setting?.dataValues.folderId || "0"
    };
  }

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
            const newFids = newFiles.map((f: any) => f.fileId);
            await this.cloud115Service.saveSharedFile({
              shareCode: task.shareCode, receiveCode: task.receiveCode,
              fids: newFids, folderId: task.folderId
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

    // --- 持久化：查看目录 ---
    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先配置 115 Cookie");
      const folderName = await this.getFolderName(folderId, cookie);
      ctx.reply(`📂 <b>当前持久化转存目录：</b>\n\n名称：${folderName}\nID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    // --- 持久化：设置目录 ---
    this.bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload;
      if (!folderId) return ctx.reply("💡 请输入 ID：/setfolder 12345");
      
      const [setting] = await UserSetting.findOrCreate({ where: { userId: adminUserId } });
      await setting.update({ folderId });
      
      const { cookie } = await this.getUserConfig(adminUserId);
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "设置成功（待获取名称）";
      ctx.reply(`✅ <b>目录已持久化保存</b>\n\n新目录：${folderName}`, { parse_mode: 'HTML' });
    });

    this.bot.command("tasks", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (tasks.length === 0) return ctx.reply("📋 目前没有任务。");
      await ctx.reply("📋 <b>追更列表：</b>", { parse_mode: 'HTML' });
      for (const t of tasks) {
        await ctx.reply(`📦 <b>${t.title}</b>`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([Markup.button.callback("❌ 取消追更", `unmt|${t.shareCode}`)])
        });
      }
    });

    this.bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词");
      const loadingMsg = await ctx.reply(`🔍 搜索 "${keyword}"...`);
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "根目录";

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((c: any) => c.list || []);
        const topItems = allItems.slice(0, 10);
        if (topItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到。");

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];
        topItems.forEach((item: any, index: number) => {
          const shareLink115 = item.cloudLinks?.find((l: string) => /115\.com\/s\//.test(l));
          responseTxt += `${index + 1}. <b>${item.title}</b>\n\n`;
          if (shareLink115) {
            const url = new URL(shareLink115);
            const sc = url.pathname.split('/').filter(p => p && p !== 's').pop() || "";
            const pc = url.searchParams.get("password") || "";
            keyboard.push([
              Markup.button.callback(`立即转存`, `sv|${sc}|${pc}|${index}`),
              Markup.button.callback(`🔔 开启追更`, `mt|${sc}|${pc}|${index}`)
            ]);
          }
        });
        responseTxt += `📂 目标: <b>${folderName}</b>`;
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) { ctx.reply("❌ 搜索失败"); }
    });

    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      const sc = ctx.match[1];
      const deleted = await MonitorTask.destroy({ where: { shareCode: sc } });
      if (deleted) await ctx.editMessageText(`❌ <b>已取消追更</b>`, { parse_mode: 'HTML' });
    });

    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const shareTitle = (shareInfo.data as any).share_title || "未命名";
        const [task, created] = await MonitorTask.findOrCreate({
          where: { shareCode: sc },
          defaults: {
            title: shareTitle, receiveCode: pc, folderId,
            processedFids: JSON.stringify((shareInfo.data.list || []).map((f: any) => f.fileId)),
            chatId: ctx.chat!.id
          }
        });
        if (!created) return ctx.reply("⚠️ 已在监控中");
        await ctx.reply(`✅ <b>追更已开启</b>\n📦 ${shareTitle}`, { parse_mode: 'HTML' });
      } catch (err: any) { await ctx.reply(`❌ 失败: ${err.message}`); }
    });

    this.bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        await this.cloud115Service.saveSharedFile({ 
            shareCode: sc, receiveCode: pc, 
            fids: (shareInfo.data.list || []).map((f: any) => f.fileId), 
            folderId 
        });
        await ctx.reply(`✅ 转存完成`);
      } catch (err: any) { await ctx.reply(`❌ 失败: ${err.message}`); }
    });

    this.bot.launch();
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true }); // 确保 folderId 字段存在
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009);
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
