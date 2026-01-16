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

/**
 * 工具函数：格式化字节
 */
function formatBytes(bytes: number, decimals = 2) {
  if (!bytes || bytes === 0) return '未知大小';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 工具函数：清晰度权重
 */
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
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service) as Cloud115Service;
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
      cookie: (setting?.get('cloud115Cookie') as string) || "",
      folderId: (setting?.get('folderId') as string) || "0"
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

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;
    this.bot = new Telegraf(token);

    // 自动注册快捷指令菜单
    this.bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 进入搜索模式' },
      { command: 'task', description: '📋 查看/管理追更任务' },
      { command: 'folder', description: '📂 查看当前转存目录' },
      { command: 'setfolder', description: '⚙️ 设置转存路径' },
      { command: 'cancel', description: '⏹ 退出当前模式' }
    ]).catch(err => logger.error("注册菜单失败:", err));

    this.bot.command("cancel", (ctx) => {
      userState.delete(ctx.from.id);
      searchCache.delete(ctx.from.id);
      ctx.reply("⏹ <b>已退出当前操作</b>", { parse_mode: 'HTML' });
    });

    this.bot.command("search", (ctx) => {
      userState.set(ctx.from.id, "SEARCHING");
      ctx.reply("🔍 <b>进入搜索模式</b>\n请发送剧名关键词。", { parse_mode: 'HTML' });
    });

    this.bot.command("setfolder", (ctx) => {
      userState.set(ctx.from.id, "SETTING_FOLDER");
      ctx.reply("⚙️ <b>设置转存路径</b>\n请发送路径文字，例如：\n<code>我的电影/2026/新剧</code>\n\n系统将自动匹配或创建文件夹。", { parse_mode: 'HTML' });
    });

    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      this.cloud115Service.cookie = cookie;
      const pathName = cookie ? await this.cloud115Service.getFolderNameById(folderId) : "尚未配置 Cookie";
      ctx.reply(`📂 <b>当前转存位置：</b>\n<code>${pathName}</code>\n(ID: ${folderId})`, { parse_mode: 'HTML' });
    });

    this.bot.command("task", async (ctx) => {
      try {
        const tasks = await MonitorTask.findAll();
        if (!tasks || tasks.length === 0) return ctx.reply("📋 <b>当前没有追更任务</b>", { parse_mode: 'HTML' });
        let msg = "📋 <b>当前追更列表：</b>\n━━━━━━━━━━━━━━\n";
        const kb = tasks.map(t => [Markup.button.callback(`❌ 取消: ${t.title.slice(0,15)}...`, `unmt|${t.shareCode}`)]);
        ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
      } catch (err) { ctx.reply("❌ 获取任务失败"); }
    });

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from.id;
      const state = userState.get(userId);
      const text = ctx.message.text.trim();

      // --- 处理路径设置逻辑 ---
      if (state === "SETTING_FOLDER") {
        const loading = await ctx.reply("⏳ 正在解析并创建路径...");
        try {
          const { cookie } = await this.getUserConfig(adminUserId);
          this.cloud115Service.cookie = cookie;
          // 注意：需要在 Cloud115Service 中实现 resolvePathToId 方法
          const targetCid = await this.cloud115Service.resolvePathToId(text);
          
          await UserSetting.upsert({
            userId: adminUserId,
            folderId: targetCid,
            cloud115Cookie: cookie
          });
          
          userState.delete(userId);
          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, 
            `✅ <b>路径设置成功！</b>\n新路径：<code>${text}</code>\nID：<code>${targetCid}</code>`, { parse_mode: 'HTML' });
        } catch (err: any) {
          ctx.reply(`❌ 设置失败: ${err.message}`);
        }
        return;
      }

      // --- 处理搜索逻辑 ---
      if (state === "SEARCHING") {
        if (/^[1-8]$/.test(text)) {
          const cache = searchCache.get(userId);
          if (!cache) return ctx.reply("❌ 缓存失效，请重新搜索");
          const selected = cache[parseInt(text) - 1];
          return this.handleTransfer(ctx, selected.sc, selected.pc, adminUserId);
        }

        const loading = await ctx.reply(`🔍 正在检索 "${text}"...`);
        try {
          const { cookie, folderId } = await this.getUserConfig(adminUserId);
          this.cloud115Service.cookie = cookie;
          const result = await this.searcher.searchAll(text);
          let allItems = (result.data || []).flatMap((g: any) => g.list || []);
          if (allItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, "❌ 未找到资源");

          allItems.sort((a: any, b: any) => getQualityInfo(b.title).weight - getQualityInfo(a.title).weight);

          let resTxt = `🔍 <b>"${text}"</b> 搜索结果:\n\n`;
          const currentCache: any[] = [];
          allItems.slice(0, 8).forEach((item: any, index: number) => {
            const num = index + 1;
            const links = [ ...(item.cloudLinks || []), item.link, item.content ].filter(Boolean);
            const shareLink = links.find((l: string) => typeof l === 'string' && /115\.com\/s\//i.test(l));
            if (shareLink) {
              const sc = shareLink.match(/\/s\/([a-zA-Z0-9]+)/)?.[1];
              const pc = shareLink.match(/password=([a-zA-Z0-9]+)/)?.[1] || item.password || "";
              currentCache.push({ sc, pc });
              resTxt += `${num}. 🎬 <b>${item.title}</b>${getQualityInfo(item.title).tag}\n📏 ${formatBytes(Number(item.size))}\n\n`;
            }
          });
          searchCache.set(userId, currentCache);
          resTxt += `💡 <b>回复数字 [1-${currentCache.length}] 一键转存</b>`;
          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, resTxt, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        } catch (err) { ctx.reply("❌ 搜索异常"); }
      }
    });

    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      await MonitorTask.destroy({ where: { shareCode: ctx.match[1] } });
      await ctx.editMessageText("❌ <b>自动追更已取消</b>", { parse_mode: 'HTML' });
    });

    this.bot.action(/^mt\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        this.cloud115Service.cookie = cookie;
        const info = await this.cloud115Service.getShareInfo(sc, pc);
        await MonitorTask.upsert({
          shareCode: sc,
          title: info.data.share_title || "未命名任务", 
          receiveCode: pc, 
          folderId: folderId || "0", 
          processedFids: JSON.stringify(info.data.list.map((f: any) => f.fileId)), 
          chatId: ctx.chat!.id 
        });
        await ctx.answerCbQuery("✅ 追更已开启");
        await ctx.reply(`✅ <b>成功开启追更：</b>\n📦 ${info.data.share_title}`, { parse_mode: 'HTML' });
      } catch (err: any) { ctx.reply("❌ 开启失败"); }
    });

    this.bot.action("cancel_action", (ctx) => ctx.deleteMessage());
    this.bot.launch();
  }

  private async handleTransfer(ctx: any, sc: string, pc: string, adminUserId: string) {
    const { cookie, folderId } = await this.getUserConfig(adminUserId);
    try {
      ctx.reply("⏳ 正在转存...");
      this.cloud115Service.cookie = cookie;
      const info = await this.cloud115Service.getShareInfo(sc, pc);
      const fids = info.data.list.map((f: any) => f.fileId);
      await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids, folderId });
      await ctx.reply(`✅ <b>转存成功！</b>\n📦 ${info.data.share_title}\n\n是否开启<b>自动追更</b>？`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback("🔔 开启追更", `mt|${sc}|${pc}|0`),
          Markup.button.callback("不需要", "cancel_action")
        ])
      });
    } catch (err: any) { ctx.reply(`❌ 转存失败: ${err.message}`); }
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true });
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009, () => logger.info("🚀 System Active on port 8009"));
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
