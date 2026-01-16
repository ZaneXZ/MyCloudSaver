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

  // 仅存储用户的目标文件夹配置
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

    // 注册快捷指令菜单
    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索 115 资源' },
      { command: 'folder', description: '📂 查看当前转存目录' },
      { command: 'setfolder', description: '✍️ 修改转存目录 ID' }
    ]);

    // --- 命令: 设置目录 ---
    bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload.trim();
      if (!folderId) return ctx.reply("💡 请输入文件夹ID。例：/setfolder 123456");
      this.userFolders.set(ctx.from.id, folderId);
      ctx.reply(`✅ 路径已更新为: ${folderId === "0" ? "根目录" : folderId}`);
    });

    // --- 命令: 查询目录 ---
    bot.command("folder", async (ctx) => {
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      ctx.reply(`📂 当前转存位置: ${folderId === "0" ? "根目录" : folderId}`);
    });

    // --- 命令: 搜索资源 ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 使用方法：/search 关键词");

      const loadingMsg = await ctx.reply("🔍 正在搜索，请稍候...");

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = result.data?.flatMap(channel => channel.list) || [];
        const filteredItems = allItems
          .filter(item => item.cloudLinks?.some((l: string) => l.includes("115.com/s/")))
          .slice(0, 10);

        if (filteredItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到 115 资源。");
        }

        const currentFolder = this.userFolders.get(ctx.from.id) || "0";
        let responseTxt = `🔍 <b>"${keyword}"</b> 搜索结果:\n\n`;
        
        // 构建按钮网格 (每行5个)
        const buttons = filteredItems.map((item, index) => {
          responseTxt += `${index + 1}. <b>${item.title}</b>\n`;
          
          const shareLink = item.cloudLinks.find((l: string) => l.includes("115cdn.com/s/"));
          const url = new URL(shareLink);
          const sc = url.pathname.split('/').pop() || "";
          const pc = url.searchParams.get("password") || "";
          
          // 回调数据格式: save|shareCode|password|index
          return Markup.button.callback(`${index + 1}`, `sv|${sc}|${pc}|${index + 1}`);
        });

        const keyboard = [];
        for (let i = 0; i < buttons.length; i += 5) {
          keyboard.push(buttons.slice(i, i + 5));
        }

        responseTxt += `\n📂 目标目录: <b>${currentFolder === "0" ? "根目录" : currentFolder}</b>\n`;
        responseTxt += `💡 <i>点击下方对应数字按钮直接转存</i>`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        logger.error("搜索失败:", err);
        ctx.reply("❌ 搜索出错。");
      }
    });

    // --- 处理内联按钮点击 ---
    bot.action(/^sv\|(.+?)\|(.+?)\|(\d+)$/, async (ctx) => {
      const [, sc, pc, idx] = ctx.match;
      const folderId = this.userFolders.get(ctx.from!.id) || "0";

      try {
        // 在顶部弹出小气泡提示
        await ctx.answerCbQuery(`正在转存第 ${idx} 个资源...`);

        const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
        const cookie = userSetting?.dataValues.cloud115Cookie;

        if (!cookie) return ctx.reply("❌ 请先在网页端登录 115");

        (this.cloud115Service as any).cookie = cookie;
        const shareInfo = await this.cloud115Service.getShareInfo(sc, pc);
        const firstFile = shareInfo.data.list[0];

        if (!firstFile) throw new Error("链接失效");

        await this.cloud115Service.saveSharedFile({
          shareCode: sc,
          receiveCode: pc,
          fids: [firstFile.fileId],
          folderId: folderId
        });

        await ctx.reply(`✅ 第 ${idx} 个转存成功！\n📦 ${firstFile.fileName}`);
      } catch (err: any) {
        await ctx.reply(`❌ 第 ${idx} 个转存失败: ${err.message}`);
      }
    });

    bot.launch();
    logger.info("🤖 机器人已启动 (内联按钮模式)");
  }

  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => logger.info(`🚀 Server on ${port}`));
    } catch (error) {
      process.exit(1);
    }
  }
}

const application = new App();
application.start();
export default application;
