import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import UserSetting from "../models/UserSetting";
import GlobalSetting from "../models/GlobalSetting";
import { Searcher } from "./Searcher";
import { ImageService } from "./ImageService";

@injectable()
export class SettingService {
  constructor(@inject(TYPES.ImageService) private imageService: ImageService) {}

  async getSettings(userId: string | undefined, role: number | undefined) {
    if (!userId) {
      throw new Error("用户ID无效");
    }

    let userSettings = await UserSetting.findOne({ where: { userId: userId.toString() } });
    if (!userSettings) {
      userSettings = await UserSetting.create({
        userId: userId.toString(),
        cloud115Cookie: "",
        quarkCookie: "",
      });
    }

    const globalSetting = await GlobalSetting.findOne();
    return {
      data: {
        userSettings,
        globalSetting: role === 1 ? globalSetting : null,
      },
    };
  }

  async saveSettings(userId: string | undefined, role: number | undefined, settings: any) {
    if (!userId) {
      throw new Error("用户ID无效");
    }

    const { userSettings, globalSetting } = settings;
    await UserSetting.update(userSettings, { where: { userId: userId.toString() } });

    if (role === 1 && globalSetting) {
      await GlobalSetting.update(globalSetting, { where: {} });
    }
    await this.updateSettings();
    return { message: "保存成功" };
  }

  async updateSettings(/* 参数 */): Promise<void> {
    // ... 其他代码 ...

    // 修改这一行，使用注入的实例方法而不是静态方法
    await this.imageService.updateAxiosInstance();
    await Searcher.updateAxiosInstance();

    // ... 其他代码 ...
  }
}
