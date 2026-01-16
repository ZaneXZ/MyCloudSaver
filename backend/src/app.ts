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
import { Telegraf, Markup } from "telegraf";
import { Searcher } from "./services/Searcher";
import { Cloud115Service } from "./services/Cloud115Service";
import UserSetting from "./models/UserSetting";
import MonitorTask from "./models/MonitorTask";

const userState = new Map<number, string>();
const searchCache = new Map<number, any[]>();

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '未知大小';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getQualityInfo(title: string) {
  const t = title.toUpperCase();
  if (t.includes("4K") || t.includes("2160P")) return { weight: 100, tag: " 💎 4K" };
  if (t.includes("1080P")) return { weight: 80, tag: " 🔵 1080P" };
  if (t.includes("REMUX")) return { weight: 90, tag: " 🎥 原盘" };
  return { weight: 0, tag: "" };
}

class App {
  private app = express();
  private databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
  private searcher = container.get<Searcher>(TYPES.Searcher);
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service) as Cloud115Service;
  private bot!: Telegraf;

  constructor() {
    this.setupExpress();
    this.setupTelegramBot();
    this.setupAutoMonitor();
  }

  private setupExpress() {
    setupMiddlewares(this.app);
    this.app.use("/", routes);
    this.app.use(errorHandler);
  }

  private async getUserConfig(adminUserId: string) {
    const setting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return {
      cookie: (setting?.get('cloud115Cookie') as string) || "",
      folderId: (setting?.get('folderId') as string) || "0",
      quarkCookie: (setting?.get('quarkCookie') as string) || ""
    };
  }

  private setupAutoMonitor() {
    setInterval(async () => {
      const adminUserId = process.env.ADMIN_USER_ID || "";
      const { cookie } = await this.getUserConfig(adminUserId);
      if (!cookie) return;
      const tasks = await MonitorTask.findAll();
      for (const task of tasks) {
        try {
          this.cloud115Service.cookie = cookie;
          const shareInfo = await this.cloud115Service.getShareInfo(task.shareCode, task.receiveCode);
          const currentFiles = shareInfo.data.list || [];
          const processedFids = new Set<string>(JSON.parse(task.processedFids));
          const newFiles = currentFiles.filter((f: any) => !processedFids.has(f.fileId));
          
          if (newFiles.length > 0) {
            await this.cloud115Service.saveSharedFile({
              shareCode: task.shareCode, 
              receiveCode: task.receiveCode,
              fids: newFiles.map((f: any) => f.fileId), 
              folderId: task.folderId || "0"
            });
            newFiles.forEach((f: any) => processedFids.add(f.fileId));
            task.processedFids = JSON.stringify(Array.from(processedFids));
            await task.save();
            await this.bot.telegram.sendMessage(task.chatId, `🔔 <b>追更成功</b>\n📦 ${task.title} 已自动更新。`, { parse_mode: 'HTML' });
          }
        } catch (err: any) { logger.error(`[追更异常]: ${err.message}`); }
      }
    }, 12 * 60 * 60 * 1000);
  }

  private setupTelegramBot() {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;
    this.bot = new Telegraf(token);

    this.bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'task', description: '📋 追更任务' },
      { command: 'folder', description: '📂 当前目录' },
      { command: 'setfolder', description: '⚙️ 设置路径' },
      { command: 'cancel', description: '⏹ 取消操作' }
    ]);

    this.bot.command("setfolder", (ctx) => {
      userState.set(ctx.from.id, "SETTING_FOLDER");
      ctx.reply("⚙️ <b>设置 115 转存路径</b>\n请直接发送文字路径，支持层级，如：\n<code>我的电影/2026/新剧</code>", { parse_mode: 'HTML' });
    });

    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      this.cloud115Service.cookie = cookie;
      const fullPath = await this.cloud115Service.getFolderNameById(folderId);
      ctx.reply(`📂 <b>当前路径：</b>\n<code>${fullPath}</code>`, { parse_mode: 'HTML' });
    });

    this.bot.command("task", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (!tasks.length) return ctx.reply("📋 暂无任务");
      const kb = tasks.map(t => [Markup.button.callback(`❌ ${t.title.slice(0,15)}`, `unmt|${t.shareCode}`)]);
      ctx.reply("📋 <b>追更任务列表：</b>", { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
    });

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from.id;
      const state = userState.get(userId);
      const text = ctx.message.text.trim();

      if (state === "SETTING_FOLDER") {
        const loading = await ctx.reply("⏳ 正在验证并创建路径...");
        try {
          const config = await this.getUserConfig(adminUserId);
          this.cloud115Service.cookie = config.cookie;
          const targetCid = await this.cloud115Service.resolvePathToId(text);
          
          await UserSetting.upsert({
            userId: adminUserId,
            folderId: targetCid,
            cloud115Cookie: config.cookie,
            quarkCookie: config.quarkCookie // 修复编译报错，带齐必填字段
          });
          
          const finalPath = await this.cloud115Service.getFolderNameById(targetCid);
          userState.delete(userId);
          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, 
            `✅ <b>路径设置成功！</b>\n📍 完整路径：<code>${finalPath}</code>`, { parse_mode: 'HTML' });
        } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
        return;
      }

      if (state === "SEARCHING" || userState.get(userId) === "SEARCHING") {
        if (/^[1-8]$/.test(text)) {
          const cache = searchCache.get(userId);
          if (cache) return this.handleTransfer(ctx, cache[parseInt(text)-1].sc, cache[parseInt(text)-1].pc, adminUserId);
        }
        userState.set(userId, "SEARCHING");
        const loading = await ctx.reply(`🔍 搜索 "${text}"...`);
        try {
          const config = await this.getUserConfig(adminUserId);
          this.cloud115Service.cookie = config.cookie;
          const result = await this.searcher.searchAll(text);
          const allItems = (result.data || []).flatMap((g: any) => g.list || []);
          if (!allItems.length) return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, "❌ 无资源");
          
          let resTxt = `🔍 搜索结果:\n\n`;
          const currentCache: any[] = [];
          allItems.slice(0, 8).forEach((item: any, i: number) => {
            const shareLink = [item.link, ...(item.cloudLinks || [])].find(l => typeof l === 'string' && l.includes('115.com/s/'));
            if (shareLink) {
              const sc = shareLink.match(/\/s\/([a-zA-Z0-9]+)/)?.[1];
              const pc = shareLink.match(/password=([a-zA-Z0-9]+)/)?.[1] || item.password || "";
              currentCache.push({ sc, pc });
              resTxt += `${i+1}. 🎬 <b>${item.title}</b>\n📏 ${formatBytes(item.size)}\n\n`;
            }
          });
          searchCache.set(userId, currentCache);
          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, resTxt + `💡 回复数字转存`, { parse_mode: 'HTML' });
        } catch (err) { ctx.reply("❌ 搜索失败"); }
      }
    });

    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      await MonitorTask.destroy({ where: { shareCode: ctx.match[1] } });
      ctx.editMessageText("❌ 已取消追更");
    });

    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        this.cloud115Service.cookie = cookie;
        const info = await this.cloud115Service.getShareInfo(sc, pc);
        await MonitorTask.upsert({
          shareCode: sc, title: info.data.share_title, receiveCode: pc,
          folderId, processedFids: JSON.stringify(info.data.list.map((f:any)=>f.fileId)), chatId: ctx.chat!.id
        });
        ctx.reply(`✅ 已开启追更: ${info.data.share_title}`);
      } catch (err) { ctx.reply("❌ 开启失败"); }
    });

    this.bot.action("cancel_action", (ctx) => ctx.deleteMessage());
    this.bot.launch();
  }

  private async handleTransfer(ctx: any, sc: string, pc: string, adminUserId: string) {
    const { cookie, folderId } = await this.getUserConfig(adminUserId);
    try {
      ctx.reply("⏳ 转存中...");
      this.cloud115Service.cookie = cookie;
      const info = await this.cloud115Service.getShareInfo(sc, pc);
      await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids: info.data.list.map((f:any)=>f.fileId), folderId });
      ctx.reply(`✅ 转存成功: ${info.data.share_title}`, Markup.inlineKeyboard([
        [Markup.button.callback("🔔 开启追更", `mt|${sc}|${pc}|0`)],[Markup.button.callback("不需要", "cancel_action")]
      ]));
    } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
  }

  public async start() {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true });
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009);
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
