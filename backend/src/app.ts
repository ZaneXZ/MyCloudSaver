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
      logger.info("🔄 [定时任务] 追更扫描中...");
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
              `🔔 <b>追更通知</b>\n📦 资源：${task.title}\n✨ 自动存入 ${newFiles.length} 个新文件。`,
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
      { command: 'tasks', description: '📋 追更列表' },
      { command: 'folder', description: '📂 查看目录' },
      { command: 'setfolder', description: '✍️ 设置目录' }
    ]);

    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "根目录";
      ctx.reply(`📂 <b>当前目录：</b>\n${folderName}\nID: <code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    this.bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload;
      if (!folderId) return ctx.reply("💡 /setfolder 12345");
      const [setting] = await UserSetting.findOrCreate({ where: { userId: adminUserId } });
      await setting.update({ folderId });
      ctx.reply(`✅ 目录已保存: <code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    this.bot.command("tasks", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (tasks.length === 0) return ctx.reply("📋 暂无任务。");
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
      const loadingMsg = await ctx.reply(`🔍 搜索 "${keyword}" 中...`);
      const { cookie, folderId } = await this.getUserConfig(adminUserId);

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((group: any) => {
          const sourceName = group.title || group.name || group.source || "未知频道";
          return (group.list || []).map((item: any) => ({ ...item, sourceName }));
        });

        const topItems = allItems.slice(0, 8);
        if (topItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");

        let responseTxt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const keyboard: any[][] = [];

        topItems.forEach((item: any, index: number) => {
          const num = index + 1;
          // 增强后的链接捕获范围
          const potentialLinks = [ ...(item.cloudLinks || []), item.link, item.content ].filter(Boolean);
          
          // 修改点：增强域名正则，支持 115cdn, 1150, anxia 等
          const shareLink = potentialLinks.find((l: string) => 
            typeof l === 'string' && /(115|anxia|115cdn|1150)\.com\/s\//i.test(l)
          );
          
          responseTxt += `${num}. <b>${item.title}</b>\n📺 来源：<code>${item.sourceName}</code>\n\n`;

          if (shareLink) {
            const scMatch = shareLink.match(/\/s\/([a-zA-Z0-9]+)/);
            const sc = scMatch ? scMatch[1] : "";
            
            let pc = "";
            try { 
                const urlObj = new URL(shareLink.trim().replace(/\s/g, ""));
                pc = urlObj.searchParams.get("password") || "";
            } catch(e) {
                const pcMatch = shareLink.match(/password=([a-zA-Z0-9]+)/);
                pc = pcMatch ? pcMatch[1] : (item.password || "");
            }

            if (sc) {
              keyboard.push([
                Markup.button.callback(`📥 转存 #${num}`, `sv|${sc}|${pc}|${index}`),
                Markup.button.callback(`🔔 追更 #${num}`, `mt|${sc}|${pc}|${index}`)
              ]);
            }
          }
        });

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) 
        });
      } catch (err) { ctx.reply("❌ 搜索失败"); }
    });

    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      await MonitorTask.destroy({ where: { shareCode: ctx.match[1] } });
      await ctx.editMessageText(`❌ 已取消追更`);
    });

    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const list = shareInfo?.data?.list || [];
        if (list.length === 0) throw new Error("链接失效");

        const shareTitle = shareInfo.data.share_title || "未命名";
        const [task, created] = await MonitorTask.findOrCreate({
          where: { shareCode: sc },
          defaults: {
            title: shareTitle, receiveCode: pc, folderId,
            processedFids: JSON.stringify(list.map((f: any) => f.fileId)),
            chatId: ctx.chat!.id
          }
        });
        ctx.reply(created ? `✅ 追更开启：${shareTitle}` : "⚠️ 已在监控中", { parse_mode: 'HTML' });
      } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
    });

    this.bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const fids = (shareInfo?.data?.list || []).map((f: any) => f.fileId);
        if (fids.length === 0) throw new Error("内容为空");

        await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids, folderId });
        ctx.reply(`✅ 转存成功`);
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
        logger.info(`🚀 Server running on port ${process.env.PORT || 8009}`);
      });
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
