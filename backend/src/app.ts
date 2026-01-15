// @ts-ignore
/**
 * Node.js v18 兼容性补丁
 * 修复在某些 Node 18 环境下 undici 库报 "ReferenceError: File is not defined" 的问题
 */
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

// === 业务依赖导入 ===
import { Telegraf, Markup } from "telegraf";
import { Searcher } from "./services/Searcher";
import { Cloud115Service } from "./services/Cloud115Service";
import UserSetting from "./models/UserSetting";

/**
 * 接口定义：用户会话状态
 */
interface UserSession {
  results: any[];        // 存储最近一次搜索的前10条结果
  targetFolderId: string; // 当前用户设定的转存目标目录 ID
}

class App {
  private app = express();
  private databaseService = container.get<DatabaseService>(TYPES.DatabaseService);
  
  // 从容器中获取单例服务
  private searcher = container.get<Searcher>(TYPES.Searcher);
  private cloud115Service = container.get<Cloud115Service>(TYPES.Cloud115Service);

  // 内存存储：管理不同用户的交互状态
  private userSessions = new Map<number, UserSession>();

  constructor() {
    this.setupExpress();
    this.setupTelegramBot();
  }

  /**
   * 初始化 Express 基础配置
   */
  private setupExpress(): void {
    setupMiddlewares(this.app);
    this.app.use("/", routes);
    this.app.use(errorHandler);
  }

  /**
   * 获取用户会话，若不存在则初始化默认值
   */
  private getSession(userId: number): UserSession {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, { results: [], targetFolderId: "0" });
    }
    return this.userSessions.get(userId)!;
  }

  /**
   * Telegram 机器人核心逻辑实现
   */
  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || "1"; 

    if (!token) {
      logger.warn("⚠️ 未找到 TG_BOT_TOKEN，机器人未启动");
      return;
    }

    const bot = new Telegraf(token);

    // --- 命令 1: 设置转存目录 ---
    bot.command("setfolder", async (ctx) => {
      const folderId = ctx.payload.trim();
      if (!folderId) return ctx.reply("💡 请输入文件夹ID。例：/setfolder 123456\n(0 代表根目录)");
      
      const session = this.getSession(ctx.from.id);
      session.targetFolderId = folderId;
      
      ctx.reply(`✅ 路径已更新！\n📂 当前转存位置: ${folderId === "0" ? "根目录" : folderId}`);
    });

    // --- 命令 2: 查询当前配置 ---
    bot.command("folder", async (ctx) => {
      const folderId = this.getSession(ctx.from.id).targetFolderId;
      ctx.reply(`📂 您当前的转存位置为: ${folderId === "0" ? "根目录 (0)" : folderId}\n\n💡 修改命令: /setfolder [ID]`);
    });

    // --- 命令 3: 搜索资源 ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 使用方法：/search 关键词");

      const loadingMsg = await ctx.reply("🔍 正在爬取资源，请稍候...");

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = result.data?.flatMap(channel => channel.list) || [];

        // 过滤出含有 115 链接的有效资源并截取前 10 条
        const filteredItems = allItems
          .filter(item => item.cloudLinks?.some((l: string) => l.includes("115.com/s/")))
          .slice(0, 10);

        if (filteredItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到 115 资源，请尝试其他关键词。");
        }

        // 更新会话中的搜索结果
        const session = this.getSession(ctx.from.id);
        session.results = filteredItems;

        let responseTxt = `🔍 <b>"${keyword}"</b> 的搜索结果:\n\n`;
        filteredItems.forEach((item, index) => {
          responseTxt += `${index + 1}. <b>${item.title}</b>\n   来源: ${item.channel}\n\n`;
        });
        
        responseTxt += `📂 转存目录: <b>${session.targetFolderId === "0" ? "根目录" : session.targetFolderId}</b>\n`;
        responseTxt += `💡 <i>发送对应数字 (1-10) 即可开始转存</i>`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, { parse_mode: 'HTML' });
      } catch (err) {
        logger.error("TG 搜索失败:", err);
        ctx.reply("❌ 搜索服务暂时不可用。");
      }
    });

    // --- 监听 4: 处理数字快捷转存 ---
    bot.on("text", async (ctx, next) => {
      const text = ctx.message.text.trim();
      const session = this.getSession(ctx.from.id);

      // 正则判断是否为 1-10 的纯数字
      if (/^\d+$/.test(text)) {
        const index = parseInt(text) - 1;
        if (session.results.length > 0 && index >= 0 && index < session.results.length) {
          const item = session.results[index];
          return this.handleQuickTransfer(ctx, item, session.targetFolderId, adminUserId);
        }
      }
      return next();
    });

    // --- 监听 5: 处理 Inline 按钮回调 (如果需要) ---
    bot.action(/^save_(.+?)_(.*)$/, async (ctx) => {
      const shareCode = ctx.match[1];
      const receiveCode = ctx.match[2];
      const folderId = this.getSession(ctx.from!.id).targetFolderId;
      await this.executeSaveAction(ctx, shareCode, receiveCode, folderId, adminUserId);
    });

    bot.launch().catch(err => logger.error("Bot Launch Error:", err));
    logger.info("🤖 Telegram Bot 已挂载成功，等待消息...");
  }

  /**
   * 处理数字选中的快捷转存逻辑
   */
  private async handleQuickTransfer(ctx: any, item: any, folderId: string, adminUserId: string) {
    const shareLink = item.cloudLinks.find((l: string) => l.includes("115.com/s/"));
    if (!shareLink) return ctx.reply("❌ 该条目未检测到有效 115 链接");

    try {
      const url = new URL(shareLink);
      const shareCode = url.pathname.split('/').pop() || "";
      const receiveCode = url.searchParams.get("password") || "";

      await ctx.reply(`🚀 正在发起转存: ${item.title.substring(0, 20)}...`);
      await this.executeSaveAction(ctx, shareCode, receiveCode, folderId, adminUserId);
    } catch (e) {
      ctx.reply("❌ 解析分享链接失败");
    }
  }

  /**
   * 执行真正的 115 API 调用逻辑
   */
  private async executeSaveAction(ctx: any, shareCode: string, receiveCode: string, folderId: string, adminUserId: string) {
    try {
      // 获取存储在数据库中的 Cookie
      const userSetting = await UserSetting.findOne({ where: { userId: adminUserId } });
      const cookie = userSetting?.dataValues.cloud115Cookie;

      if (!cookie) {
        return ctx.reply("❌ 未检测到 115 Cookie，请先在网页端登录保存。");
      }

      // 临时注入 Cookie 执行 API
      (this.cloud115Service as any).cookie = cookie;

      // 获取分享详情获取 fid
      const shareInfo = await this.cloud115Service.getShareInfo(shareCode, receiveCode);
      const firstFile = shareInfo.data.list[0];

      if (!firstFile) throw new Error("分享链接已失效或文件夹为空");

      // 执行保存接口
      const saveResult = await this.cloud115Service.saveSharedFile({
        shareCode,
        receiveCode,
        fids: [firstFile.fileId],
        folderId: folderId
      });

      await ctx.reply(`✅ 转存成功！\n📦 文件: ${firstFile.fileName}\n📂 目录: ${folderId === "0" ? "根目录" : folderId}`);
    } catch (err: any) {
      logger.error("转存执行失败:", err);
      await ctx.reply(`❌ 转存失败: ${err.message || "未知错误"}`);
    }
  }

  /**
   * 应用启动入口
   */
  public async start(): Promise<void> {
    try {
      await this.databaseService.initialize();
      logger.info("数据库初始化成功");

      const port = process.env.PORT || 8009;
      this.app.listen(port, () => {
        logger.info(`🚀 服务器运行在端口: ${port} [${process.env.NODE_ENV || 'dev'}]`);
      });
    } catch (error) {
      logger.error("启动失败:", error);
      process.exit(1);
    }
  }
}

// 实例化并运行
const application = new App();
application.start();

export default application;
