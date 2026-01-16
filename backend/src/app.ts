// ... (补丁部分保持不变)

class App {
  // ... (属性定义保持不变)

// --- 增强版：通过 ID 获取文件夹真实名称 ---
  private async getFolderName(folderId: string, cookie: string): Promise<string> {
    if (folderId === "0" || !folderId) return "根目录";
    try {
      const resp = await axios.get(`https://webapi.115.com/files/getid?cid=${folderId}`, {
        headers: { 
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://115.com/?cid=${folderId}&offset=0&mode=wangpan`,
          'Accept': '*/*'
        },
        timeout: 5000 // 5秒超时
      });

      // 115 API 可能返回 name 或 file_name，这里做双重校验
      const folderName = resp.data?.name || resp.data?.file_name;
      
      if (folderName) {
        return folderName;
      } else {
        // 如果 API 返回成功但没有名字，可能是被限制了，记录一下日志
        logger.warn(`115返回数据中未找到名称: ${JSON.stringify(resp.data)}`);
        return `未命名目录(${folderId})`;
      }
    } catch (e: any) {
      logger.error(`获取文件夹名称失败 (ID: ${folderId}): ${e.message}`);
      return `目录(${folderId})`; // 最终保底
    }
  }

  // ... (resolvePathToId 保持不变，用于 setfolder 兼容)

  private setupTelegramBot(): void {
    const token = process.env.TG_BOT_TOKEN;
    const adminUserId = process.env.ADMIN_USER_ID || ""; 

    if (!token) return;
    const bot = new Telegraf(token);

    // --- 指令设置 ---
    bot.telegram.setMyCommands([
      { command: 'search', description: '🔍 搜索资源' },
      { command: 'folder', description: '📂 查看当前目录' },
      { command: 'setfolder', description: '✍️ 设置转存路径' }
    ]);

    // ... (setfolder 和 folder 命令保持不变)

    // --- 核心修改：搜索资源并回显路径 ---
    bot.command("search", async (ctx) => {
      const keyword = ctx.payload;
      if (!keyword) return ctx.reply("💡 请输入关键词，例如：/search 庆余年");

      const loadingMsg = await ctx.reply(`🔍 正在全网检索 "${keyword}"...`);
      const cookie = await this.get115Cookie(adminUserId);
      
      // 实时获取当前用户设定的 ID
      const folderId = this.userFolders.get(ctx.from.id) || "0";
      // 实时查询该 ID 对应的文件夹名称
      const folderName = cookie ? await this.getFolderName(folderId, cookie) : "未登录";

      try {
        const result = await this.searcher.searchAll(keyword);
        const allItems = result.data?.flatMap(channel => channel.list) || [];
        const topItems = allItems.slice(0, 10);

        if (topItems.length === 0) {
          return ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, "❌ 未找到资源。");
        }

        let responseTxt = `🔍 <b>"${keyword}"</b> 搜索结果:\n\n`;
        const keyboard: any[][] = [];
        let currentRow: any[] = [];

        topItems.forEach((item, index) => {
          const shareLink115 = item.cloudLinks?.find((l: string) => /https?:\/\/(?:115|anxia|115cdn|115\.me)\.com?\/s\//i.test(l));
          const typeIcon = shareLink115 ? "🔵" : "⚪";
          responseTxt += `${index + 1}. ${typeIcon} <b>${item.title}</b>\n   来源: ${item.channel}\n\n`;
          
          if (shareLink115) {
            const url = new URL(shareLink115);
            const sc = url.pathname.split('/').filter(p => p && p !== 's').pop() || "";
            const pc = url.searchParams.get("password") || "";
            currentRow.push(Markup.button.callback(`${index + 1} (存)`, `sv|${sc}|${pc}|${index + 1}`));
          } else if (item.cloudLinks?.[0]) {
            currentRow.push(Markup.button.url(`${index + 1} (看)`, item.cloudLinks[0]));
          }

          if (currentRow.length === 5 || index === topItems.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
          }
        });

        // --- 实时回显部分 ---
        responseTxt += `--- --- --- --- ---\n`;
        responseTxt += `📂 当前转存至: <b>${folderName}</b>\n`;
        responseTxt += `🆔 目录ID: <code>${folderId}</code>\n`;
        responseTxt += `💡 <i>点击 (存) 按钮将直接保存至上方路径</i>`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, responseTxt, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        });
      } catch (err) {
        logger.error("搜索失败:", err);
        ctx.reply("❌ 搜索出错，请稍后重试");
      }
    });

    // ... (action 回调逻辑保持不变)

    bot.launch();
    logger.info("🤖 机器人搜索增强版启动成功");
  }

  public async start(): Promise<void> {
    // ...
  }
}

const application = new App();
application.start();
export default application;
