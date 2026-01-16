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

// 用于管理用户是否处于搜索模式
const userState = new Map<number, string>();

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

  // --- 获取用户配置 ---
  private async getUserConfig(adminUserId: string) {
    const setting = await UserSetting.findOne({ where: { userId: adminUserId } });
    return {
      cookie: setting?.dataValues.cloud115Cookie || null,
      folderId: setting?.dataValues.folderId || "0"
    };
  }

  // --- 获取文件夹全路径名称 ---
  private async getFullFolderPath(folderId: string, cookie: string): Promise<string> {
    if (!folderId || folderId === "0") return "/ (根目录)";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { 'Cookie': cookie }
      });
      // 115 接口通常返回当前文件夹名，如果有 path 数组则拼接
      const name = resp.data?.name || folderId;
      return `/${name}`;
    } catch { return `/未知目录(${folderId})`; }
  }

  // --- 自动化追更扫描 ---
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
            await this.bot.telegram.sendMessage(task.chatId, `🔔 <b>自动追更成功</b>\n📦 资源：${task.title}\n✨ 新增：${newFiles.length} 集`, { parse_mode: 'HTML' });
          }
        } catch (err: any) { logger.error(`[追更异常] ${task.title}: ${err.message}`); }
      }
    }, 12 * 60 * 60 * 1000);
  }

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "";
    if (!token) return;
    this.bot = new Telegraf(token);

    // 1. 设置转存目录
    this.bot.command("setfolder", async (ctx) => {
      const input = ctx.payload.trim();
      if (!input) return ctx.reply("💡 请输入目录ID或路径\n示例: <code>/setfolder /我的资源/追更</code>", { parse_mode: 'HTML' });
      const { cookie } = await this.getUserConfig(adminUserId);
      if (!cookie) return ctx.reply("❌ 请先配置 115 Cookie");
      const loading = await ctx.reply("⏳ 正在验证并转换路径...");
      try {
        let finalCid = /^\d+$/.test(input) ? input : await (this.cloud115Service as any).getCidByPath(input);
        const [setting] = await UserSetting.findOrCreate({ where: { userId: adminUserId } });
        await setting.update({ folderId: finalCid });
        const name = await this.getFullFolderPath(finalCid, cookie);
        await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `✅ <b>转存目录设置成功</b>\n当前路径: <code>${name}</code>\n对应 ID: <code>${finalCid}</code>`, { parse_mode: 'HTML' });
      } catch (err: any) { await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, `❌ 错误: ${err.message}`); }
    });

    // 2. 查看目录命令
    this.bot.command("folder", async (ctx) => {
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      const pathName = cookie ? await this.getFullFolderPath(folderId, cookie) : "未知";
      ctx.reply(`📂 <b>当前设定的转存位置：</b>\n\n路径：<code>${pathName}</code>\nID：<code>${folderId}</code>`, { parse_mode: 'HTML' });
    });

    // 3. 追更任务命令
    this.bot.command("task", async (ctx) => {
      const tasks = await MonitorTask.findAll();
      if (tasks.length === 0) return ctx.reply("📋 当前没有任何自动追更任务。");
      
      let msg = "📋 <b>当前追更任务列表：</b>\n\n";
      const kb: any[][] = [];
      tasks.forEach((t, i) => {
        msg += `${i+1}. ${t.title}\n`;
        kb.push([Markup.button.callback(`❌ 取消追更: ${t.title.slice(0,10)}...`, `unmt|${t.shareCode}`)]);
      });
      ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
    });

    // 4. 搜索模式触发
    this.bot.command("search", (ctx) => {
      userState.set(ctx.from.id, "SEARCHING");
      ctx.reply("🔍 <b>已进入搜索模式</b>\n请直接发送你想搜索的<b>剧名</b>。\n\n输入 <code>退出</code> 或 <code>/cancel</code> 可结束搜索。", { parse_mode: 'HTML' });
    });

    // 5. 退出搜索
    this.bot.command("cancel", (ctx) => {
      userState.delete(ctx.from.id);
      ctx.reply("已退出搜索模式。");
    });

    // 6. 处理搜索文字及搜索逻辑
    this.bot.on("text", async (ctx) => {
      const state = userState.get(ctx.from.id);
      const text = ctx.message.text.trim();

      if (state === "SEARCHING") {
        if (text === "退出" || text === "取消") {
          userState.delete(ctx.from.id);
          return ctx.reply("已退出搜索模式。");
        }

        const loading = await ctx.reply(`正在检索 "${text}"...`);
        try {
          const { cookie, folderId } = await this.getUserConfig(adminUserId);
          const pathName = cookie ? await this.getFullFolderPath(folderId, cookie) : "根目录";
          const result = await this.searcher.searchAll(text);
          
          const allItems = (result.data || []).flatMap((g: any) => {
            const source = g.title || g.name || g.source || g.site || "资源频道";
            return (g.list || []).map((i: any) => ({ ...i, sourceName: source }));
          });

          if (allItems.length === 0) return ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, "❌ 未找到相关资源，请换个词试试。");

          let resTxt = `🔍 <b>"${text}"</b> 的搜索结果:\n`;
          resTxt += `📂 预定存入：<code>${pathName}</code>\n\n`;
          
          const kb: any[][] = [];
          allItems.slice(0, 8).forEach((item: any, index: number) => {
            const num = index + 1;
            const links = [ ...(item.cloudLinks || []), item.link, item.content ].filter(Boolean);
            const shareLink = links.find((l: string) => typeof l === 'string' && /(115|anxia|115cdn|1150)\.com\/s\//i.test(l));
            
            resTxt += `${num}. <b>${item.title}</b>\n📺 来源：${item.sourceName}\n\n`;
            if (shareLink) {
              const sc = shareLink.match(/\/s\/([a-zA-Z0-9]+)/)?.[1];
              const pc = shareLink.match(/password=([a-zA-Z0-9]+)/)?.[1] || item.password || "";
              if (sc) kb.push([Markup.button.callback(`📥 转存 #${num}`, `sv|${sc}|${pc}|${index}`)]);
            }
          });

          await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, undefined, resTxt, {
            parse_mode: 'HTML', ...Markup.inlineKeyboard(kb)
          });
        } catch (err) { ctx.reply("❌ 搜索失败，请重试"); }
      }
    });

    // 按钮回调处理：转存、追更、取消追更
    this.bot.action(/^unmt\|(.+)$/, async (ctx) => {
      await MonitorTask.destroy({ where: { shareCode: ctx.match[1] } });
      await ctx.answerCbQuery("追更已取消");
      await ctx.editMessageText("❌ <b>该资源已从追更列表中移除</b>", { parse_mode: 'HTML' });
    });

    this.bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc] = ctx.match;
      const { cookie, folderId } = await this.getUserConfig(adminUserId);
      try {
        await ctx.answerCbQuery("正在极速转存...");
        (this.cloud115Service as any).cookie = cookie;
        const info = await this.cloud115Service.getShareInfo(sc, pc);
        const fids = info.data.list.map((f: any) => f.fileId);
        await this.cloud115Service.saveSharedFile({ shareCode: sc, receiveCode: pc, fids, folderId });
        await ctx.reply(`✅ <b>转存成功！</b>\n📦 ${info.data.share_title}\n\n是否为此资源开启<b>自动追更</b>？`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            Markup.button.callback("🔔 开启自动追更", `mt|${sc}|${pc}|0`),
            Markup.button.callback("忽略", "cancel_action")
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
        await ctx.answerCbQuery("追更任务已创建");
        await ctx.editMessageText(`✅ <b>已成功开启自动追更</b>\n\n我们将每12小时扫描一次：\n<b>${info.data.share_title}</b>`, { parse_mode: 'HTML' });
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
      this.app.listen(process.env.PORT || 8009, () => logger.info("🚀 Bot & Server is Ready!"));
    } catch (error) { process.exit(1); }
  }
}

const application = new App();
application.start();
export default application;
