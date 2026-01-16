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
    if (!folderId || folderId === "0") return "根目录";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, { headers: { 'Cookie': cookie } });
      return resp.data?.name || `目录(${folderId})`;
    } catch { return `目录(${folderId})`; }
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
            await this.bot.telegram.sendMessage(task.chatId, `🔔 <b>追更通知</b>\n📦 ${task.title} 已更新 ${newFiles.length} 集`, { parse_mode: 'HTML' });
          }
        } catch (err: any) { logger.error(`[追更错误] ${task.title}: ${err.message}`); }
      }
    }, 12 * 60 * 60 * 1000);
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;
    this.bot = new Telegraf(token);

    this.bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input) return ctx.reply("💡 请输入目录ID或路径\n示例: <code>/setfolder /我的资源/追更</code>", { parse_mode: 'HTML' });
      
      const { cookie } = await this.getUserConfig(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先配置 115 Cookie");

      const loading = await ctx.reply("⏳ 正在验证路径...");
      try {
        let finalCid = /^\d+$/.test(input) ? input : await (this.cloud115Service as any).getCidByPath(input);
        const [setting] = await UserSetting.findOrCreate({ where: { userId: adminUserId } });
        await setting.update({ folderId: finalCid });
        const name = await this.getFolderName(finalCid, cookie);
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `✅ <b>设置成功</b>\n当前目录: <code>${name}</code>`, { parse_mode: 'HTML' });
      } catch (err: any) {
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `❌ 错误: ${err.message}`);
      }
    });

    this.bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("请输入关键词");
      const loading = await ctx.reply(`🔍 搜索 "${keyword}"...`);
      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = (result.data || []).flatMap((g: any) => {
          const source = g.title || g.name || g.source || g.site || "资源频道";
          return (g.list || []).map((i: any) => ({ ...i, sourceName: source }));
        });
        if (allItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, "❌ 未找到资源");

        let txt = `🔍 <b>"${keyword}"</b> 结果:\n\n`;
        const kb: any[][] = [];
        allItems.slice(0, 8).forEach((item: any, index: number) => {
          const num = index + 1;
          const links = [ ...(item.cloudLinks || []), item.link, item.content ].filter(Boolean);
          const shareLink = links.find((l: string) => typeof l === 'string' && /(115|anxia|115cdn|1150)\.com\/s\//i.test(l));
          txt += `${num}. <b>${item.title}</b>\n📺 来源：${item.sourceName}\n\n`;
          if (shareLink) {
            const sc = shareLink.match(/\/s\/([a-zA-Z0-9]+)/)?.[1];
            const pc = shareLink.match(/password=([a-zA-Z0-9]+)/)?.[1] || item.password || "";
            if (sc) kb.push([Markup.button.callback(`📥 转存 #${num}`, `sv|${sc}|${pc}|${index}`)]);
          }
        });
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, txt, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
      } catch (err) { ctx.reply("❌ 搜索失败"); }
    });

    this.bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        await ctx.answerCbQuery("正在转存...");
        (this.cloud115Service as any).cookie = cookie;
        const info = await this.cloud115Service.getShareInfo(sc, pc);
        const fids = info.data.list.map((f: any) => f.fileId);
        await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids, folderId });
        await ctx.reply(`✅ <b>转存成功</b>\n📦 ${info.data.share_title}\n\n是否开启自动追更？`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback("🔔 开启追更", `mt|${sc}|${pc}|0`),
            Markup.button.callback("不需要", "cancel_action")
          ])
        });
      } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
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
        await ctx.answerCbQuery("追更已开启");
        await ctx.editMessageText(`✅ <b>已开启自动追更</b>\n资源: ${info.data.share_title}`);
      } catch (err: any) { ctx.reply(`❌ 失败: ${err.message}`); }
    });

    this.bot.action("cancel_action", (ctx) => ctx.deleteMessage());
    this.bot.launch();
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      await UserSetting.sync({ alter: true });
      await MonitorTask.sync({ alter: true });
      this.app.listen(process.env.PORT || 8009, () => logger.info("🚀 App Started"));
    } catch (error) { process.exit(1); }
  }
}
const application = new App();
application.start();
export default application;
