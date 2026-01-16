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

// 工具函数：格式化大小
function formatBytes(bytes: number, decimals = 2) {
  if (!bytes || bytes === 0) return '未知大小';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 工具函数：清晰度权重
function getQualityInfo(title: string) {
  const t = title.toUpperCase();
  if (t.includes("4K") || t.includes("2160P")) return { weight: 100, tag: " 💎 4K" };
  if (t.includes("1080P")) return { weight: 80, tag: " 🔵 1080P" };
  if (t.includes("REMUX")) return { weight: 90, tag: " 🎥 原盘" };
  if (t.includes("BD") || t.includes("BLU-RAY")) return { weight: 70, tag: " 💿 蓝光" };
  if (t.includes("720P")) return { weight: 60, tag: " 🟢 720P" };
  return { weight: 0, tag: "" };
}

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

  private setupAutoMonitor() {
    setInterval(async () => {
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
              shareCode: task.shareCode, receiveCode: task.receiveCode,
              fids: newFiles.map((f: any) => f.fileId), folderId: task.folderId || "0"
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

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;
    this.bot = new Telegraf(token);

    this.bot.command("cancel", (ctx) => {
      userState.delete(ctx.from.id);
      searchCache.delete(ctx.from.id);
      ctx.reply("⏹ <b>搜索模式已退出</b>", { parse_mode: 'HTML' });
    });

    this.bot.command("search", (ctx) => {
      userState.set(ctx.from.id, "SEARCHING");
      ctx.reply("🔍 <b>进入搜索模式</b>\n请发送剧名，搜索后回复<b>数字</b>转存。\n发送 <code>/cancel</code> 退出。", { parse_mode: 'HTML' });
    });

    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      (this.cloud115Service as any).cookie = cookie;
      const pathName = cookie ? await (this.cloud115Service as any).getFolderNameById(folderId) : "未知";
      ctx.reply(`📂 <b>当前转存位置：</b>\n<code>${pathName}</code>`, { parse_mode: 'HTML' });
    });

    this.bot.command("task", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (tasks.length === 0) return ctx.reply("📋 无正在追更的任务");
      let msg = "📋 <b>当前追更列表：</b>\n\n";
      const kb = tasks.map(t => [Markup.button.callback(`❌ 取消: ${t.title.slice(0,12)}...`, `unmt|${t.shareCode}`)]);
      ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
    });

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from.id;
      const state = userState.get(userId);
      const text = ctx.message.text.trim();

      if (state === "SEARCHING") {
        if (/^[1-8]$/.test(text)) {
          const cache = searchCache.get(userId);
          if (!cache) return ctx.reply("❌ 请先执行搜索");
          const selected = cache[parseInt(text) - 1];
          if (!selected) return ctx.reply("❌ 选择超出范围");
          return this.handleTransfer(ctx, selected.sc, selected.pc, adminUserId);
        }

        const loading = await ctx.reply(`正在检索 "${text}"...`);
        try {
          const { cookie, folderId } = await this.getUserConfig(adminUserId);
          (this.cloud115Service as any).cookie = cookie;
          const pathName = await (this.cloud115Service as any).getFolderNameById(folderId);

          const result = await this.searcher.searchAll(text);
          let allItems = (result.data || []).flatMap((g: any) => g.list || []);
          if (allItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, "❌ 未找到资源");

          // 智能排序
          allItems.sort((a: any, b: any) => {
            const qA = getQualityInfo(a.title).weight;
            const qB = getQualityInfo(b.title).weight;
            if (qA !== qB) return qB - qA;
            return Number(b.size || 0) - Number(a.size || 0);
          });

          let resTxt = `🔍 <b>"${text}"</b> 搜索结果:\n`;
          resTxt += `📂 转存至：<code>${pathName}</code>\n\n`;
          const currentCache: any[] = [];
          
          allItems.slice(0, 8).forEach((item: any, index: number) => {
            const num = index + 1;
            const links = [ ...(item.cloudLinks || []), item.link, item.content ].filter(Boolean);
            const shareLink = links.find((l: string) => typeof l === 'string' && /(115|anxia|115cdn|1150)\.com\/s\//i.test(l));
            const sizeStr = formatBytes(Number(item.size || 0));
            const q = getQualityInfo(item.title);
            
            resTxt += `${num}. 🎬 <b>${item.title}</b>${q.tag}\n📏 大小：<code>${sizeStr}</code>\n🔗 <a href="${shareLink || '#'}">查看资源</a>\n\n`;
            if (shareLink) {
              const sc = shareLink.match(/\/s\/([a-zA-Z0-9]+)/)?.[1];
              const pc = shareLink.match(/password=([a-zA-Z0-9]+)/)?.[1] || item.password || "";
              currentCache.push({ sc, pc });
            }
          });

          searchCache.set(userId, currentCache);
          resTxt += `💡 <b>回复数字 [1-${currentCache.length}] 即可转存</b>`;
          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, resTxt, { parse_mode: 'HTML', disable_web_page_preview: true });
        } catch (err) { ctx.reply("❌ 搜索处理失败"); }
      }
    });

    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      await MonitorTask.destroy({ where: { shareCode: ctx.match[1] } });
      await ctx.editMessageText("❌ <b>已取消自动追更</b>", { parse_mode: 'HTML' });
    });

    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        (this.cloud115Service as any).cookie = cookie;
        const info = await this.cloud115Service.getShareInfo(sc, pc);
        await MonitorTask.findOrCreate({
          where: { shareCode: sc },
          defaults: { title: info.data.share_title, receiveCode: pc, folderId, processedFids: JSON.stringify(info.data.list.map((f:any)=>f.fileId)), chatId: ctx.chat!.id }
        });
        await ctx.answerCbQuery("追更开启");
        await ctx.reply(`✅ <b>已开启追更：</b> ${info.data.share_title}`, { parse_mode: 'HTML' });
      } catch (err: any) { ctx.reply("❌ 开启追更失败"); }
    });

    this.bot.action("cancel_action", (ctx) => ctx.deleteMessage());
    this.bot.launch();
  }

  private async handleTransfer(ctx: any, sc: string, pc: string, adminUserId: string) {
    const { cookie, folderId } = await this.getUserConfig(adminUserId);
    try {
      ctx.reply("⏳ 正在转存，请稍候...");
      (this.cloud115Service as any).cookie = cookie;
      const info = await this.cloud115Service.getShareInfo(sc, pc);
      const fids = info.data.list.map((f: any) => f.fileId);
      await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids, folderId });
      await ctx.reply(`✅ <b>转存成功！</b>\n📦 ${info.data.share_title}\n\n需要自动追更吗？`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback("🔔 开启追更", `mt|${sc}|${pc}|0`),
          Markup.button.callback("忽略", "cancel_action")
        ])
      });
    } catch (err: any) { ctx.reply(`❌ 转存失败: ${err.message}`); }
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true });
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009, () => logger.info("🚀 System Active"));
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
