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

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "1";

    if (!token) {
      logger.warn("⚠️ 未找到 TG_BOT_TOKEN");
      return;
    }

    const bot = new Telegraf(token);

    // 设置指令菜单
    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 全网搜索 (支持 115 一键转存)' },
      { command: 'folder', description: '📂 查看当前 115 转存目录' },
      { command: 'setfolder', description: '✍️ 修改 115 转存目录 ID' }
    ]);

    bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload.trim();
      if (!folderId) return ctx.reply("💡 请输入文件夹 ID (例: /setfolder 0)");
      this.userFolders.set(ctx.from.id, folderId);
      ctx.reply(`✅ 115 转存路径已设置为: ${folderId === "0" ? "根目录" : folderId}`);
    });

    bot.command("folder", async (ctx) => {
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      ctx.reply(`📂 当前 115 转存目录 ID: ${folderId}`);
    });

    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词，例如：/search 庆余年");

      const loadingMsg = await ctx.reply(`🔍 正在检索 "${keyword}"...`);

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = result.data?.flatMap(channel => channel.list) || [];
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");
        }

        const currentFolder = this.userFolders.get(ctx.from.id) || "0";
        let responseTxt = `🔍 <b>"${keyword}"</b> 搜索结果:\n\n`;
        
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item, index) => {
          // 兼容性识别 115 及其所有变体域名
          const shareLink115 = item.cloudLinks?.find((l: string) => 
            /https?:\/\/(?:115|anxia|115cdn|115\.me)\.com?\/s\//i.test(l)
          );
          
          const typeIcon = shareLink115 ? "🔵" : "⚪";
          responseTxt += `${index + 1}. ${typeIcon} <b>${item.title}</b>\n   来源: ${item.channel} | ${item.cloudType || '网盘'}\n\n`;
          
          if (shareLink115) {
            try {
              const url = new URL(shareLink115);
              // 精准提取 shareCode：过滤掉路径中的 's'
              const sc = url.pathname.split('/').filter(p => p && p !== 's').pop() || "";
              const pc = url.searchParams.get("password") || "";
              
              if (sc) {
                currentRow.push(Markup.button.callback(`${index + 1} (存)`, `sv|${sc}|${pc}|${index + 1}`));
              } else {
                currentRow.push(Markup.button.url(`${index + 1} (看)`, shareLink115));
              }
            } catch (e) {
              currentRow.push(Markup.button.url(`${index + 1} (看)`, shareLink115));
            }
          } else if (item.cloudLinks?.[0]) {
            currentRow.push(Markup.button.url(`${index + 1} (看)`, item.cloudLinks[0]));
          }

          if (currentRow.length === 5 || index === topItems.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
          }
        });

        responseTxt += `📂 转存至: <b>${currentFolder === "0" ? "根目录" : currentFolder}</b>\n`;
        responseTxt += `💡 🔵 为 115 资源(点序号一键转存)\n   ⚪ 为其他资源(点序号跳转浏览器)`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        logger.error("搜索报错:", err);
        ctx.reply("❌ 搜索失败。");
      }
    });

    // 按钮回调处理
    bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc, idx] = ctx.match;
      const folderId = this.userFolders.get(ctx.from!.id) || "0";

      try {
        await ctx.answerCbQuery(`🚀 正在转存第 ${idx} 个...`);
        const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
        const cookie = userSetting?.dataValues.cloud115Cookie;

        if (!cookie) return ctx.reply("❌ 错误：请先在网页端登录并保存 115 设置。");

        (this.cloud115Service as any).cookie = cookie;
        
        // 注意：API 请求不关心域名，只要提取出的 sc (shareCode) 是正确的
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const firstFile = shareInfo.data.list[0];

        if (!firstFile) throw new Error("资源已失效");

        await this.cloud115Service.saveSharedFile({
          shareCode: sc,
          receiveCode: pc,
          fids: [firstFile.fileId],
          folderId: folderId
        });

        await ctx.reply(`✅ 转存成功！\n📦 ${firstFile.fileName}\n📂 目录ID: ${folderId}`);
      } catch (err: any) {
        await ctx.reply(`❌ 第 ${idx} 个转存失败: ${err.message}`);
      }
    });

    bot.launch();
    logger.info("🤖 115 助手机器人已启动");
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => logger.info(`🚀 Server listening on ${port}`));
    } catch (error) {
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
