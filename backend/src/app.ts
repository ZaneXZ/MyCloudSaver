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
// filepath: /d:/code/CloudDiskDown/backend/src/app.ts
import "./types/express";
import express from "express";
import { container } from "./inversify.config";
import { TYPES } from "./core/types";
import { DatabaseService } from "./services/DatabaseService";
import { setupMiddlewares } from "./middleware";
import routes from "./routes/api";
import { logger } from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";

// === TG BOT 依赖导入 ===
import { Telegraf, Markup } from "telegraf";
import { Searcher } from "./services/Searcher";
import { Cloud115Service } from "./services/Cloud115Service";
import UserSetting from "./models/UserSetting";

class App {
  private app = express();
  private databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
  
  // 从容器中获取搜索和转存服务实例
  private searcher = container.get<Searcher>(TYPES.Searcher);
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service);

  constructor() {
    this.setupExpress();
    // 初始化机器人
    this.setupTelegramBot();
  }

  private setupExpress(): void {
    // 设置中间件
    setupMiddlewares(this.app);

    // 设置路由
    this.app.use("/", routes);
    this.app.use(errorHandler);
  }

  // === TG BOT 逻辑核心实现 ===
  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    // 默认管理员 ID，需确保数据库 UserSettings 表中有该 userId 的 115 Cookie
    const adminUserId = process.env.ADMIN_USER_ID || "1"; 

    if (!token) {
      logger.warn("⚠️ 未找到 TG_BOT_TOKEN，Telegram 机器人未启动");
      return;
    }

    const bot = new Telegraf(token);

    // 1. 搜索指令：/search 关键词
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 使用方法：/search 关键词\n例如：/search 庆余年");

      const loadingMsg = await ctx.reply("🔍 正在全网搜索 115 资源，请稍候...");

      try {
        const result = await this.searcher.searchAll(keyword);
        
        if (!result.data || result.data.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到相关资源。");
        }

        // 扁平化处理所有频道的结果
        const allItems = result.data.flatMap(channel => channel.list);
        
        // 仅发送前 8 条结果，避免触发 TG 频率限制
        for (const item of allItems.slice(0, 8)) {
          // 寻找 115 分享链接
          const shareLink = item.cloudLinks?.find((l: string) => l.includes("115.com/s/"));
          
          if (shareLink) {
            // 解析 shareCode 和 password
            const url = new URL(shareLink);
            const shareCode = url.pathname.split('/').pop() || "";
            const receiveCode = url.searchParams.get("password") || "";

            const caption = `<b>📂 资源:</b> ${item.title}\n` +
                            `<b>📡 频道:</b> ${item.channel}\n` +
                            `<b>🔗 类型:</b> ${item.cloudType || '115网盘'}`;

            await ctx.reply(caption, {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.button.callback("🚀 立即转存到 115", `save_${shareCode}_${receiveCode}`)]
              ])
            });
          }
        }

        ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch (err) {
        logger.error("TG 搜索报错:", err);
        ctx.reply("❌ 搜索过程中发生错误，请检查日志。");
      }
    });

    // 2. 处理转存动作
    bot.action(/^save_(.+?)_(.*)$/, async (ctx) => {
      const shareCode = ctx.match[1];
      const receiveCode = ctx.match[2];

      try {
        await ctx.answerCbQuery("正在获取文件信息...");

        // 获取该管理员的 115 Cookie
        const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
        const cookie = userSetting?.dataValues.cloud115Cookie;

        if (!cookie) {
          return ctx.reply("❌ 错误：请先在网页端登录 115 网盘并保存设置。");
        }

        // 注入 Cookie (利用私有变量注入，绕过请求对象限制)
        (this.cloud115Service as any).cookie = cookie;

        // 获取分享快照中的文件 ID
        const shareInfo = await this.cloud115Service.getShareInfo(shareCode, receiveCode);
        const firstFile = shareInfo.data.list[0];

        if (!firstFile) throw new Error("分享内容为空或已失效");

        // 执行保存
        await this.cloud115Service.saveSharedFile({
          shareCode,
          receiveCode,
          fids: [firstFile.fileId],
          folderId: "0" // 默认转存到 115 根目录
        });

        await ctx.reply(`✅ 成功转存至 115！\n📦 文件名: ${firstFile.fileName}`);
      } catch (err: any) {
        logger.error("TG 转存失败:", err);
        await ctx.reply(`❌ 转存失败: ${err.message}`);
      }
    });

    bot.launch();
    logger.info("🤖 Telegram Bot 模块已成功挂载并启动");
  }

  public async start(): Promise<void> {
    try {
      // 初始化数据库
      await this.databaseService.initialize();
      logger.info("数据库初始化成功");

      // 启动服务器
      const port = process.env.PORT || 8009;
      this.app.listen(port, () => {
        logger.info(`
🚀 服务器启动成功
🌍 监听端口: ${port}
🔧 运行环境: ${process.env.NODE_ENV || "development"}
        `);
      });
    } catch (error) {
      logger.error("服务器启动失败:", error);
      process.exit(1);
    }
  }
}

// 创建并启动应用
const application = new App();
application.start().catch((error) => {
  logger.error("应用程序启动失败:", error);
  process.exit(1);
});

export default application;
