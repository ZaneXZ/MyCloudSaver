import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";
// 如果你不再需要和 User 模型强关联，可以注释掉下面这行
// import User from "./User";

interface UserSettingAttributes {
  id: number;
  userId: string;          // 现在用于存储 Telegram User ID (如 "12345678")
  cloud115UserId?: string;
  cloud115Cookie: string;
  quarkCookie: string;
  cloud115DirId?: string;  // 新增：用于持久化存储 115 的目录 ID
}

// 定义创建时可选的属性
interface UserSettingCreationAttributes extends Optional<UserSettingAttributes, "id" | "cloud115DirId" | "cloud115Cookie" | "quarkCookie"> {}

class UserSetting
  extends Model<UserSettingAttributes, UserSettingCreationAttributes>
  implements UserSettingAttributes
{
  public id!: number;
  public userId!: string;
  public cloud115UserId?: string;
  public cloud115Cookie!: string;
  public quarkCookie!: string;
  public cloud115DirId?: string; // 显式声明新增属性

  // 时间戳自动管理 (Sequelize 默认开启)
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserSetting.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING, // 核心改动：UUID -> STRING
      allowNull: false,
      unique: true,
      comment: "存储 Telegram 用户的数字 ID",
    },
    cloud115UserId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cloud115Cookie: {
      type: DataTypes.TEXT, // 建议使用 TEXT，防止 Cookie 过长被截断
      allowNull: true,
    },
    quarkCookie: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cloud115DirId: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "0", // 默认转存到根目录
      comment: "115 转存的目标文件夹 ID",
    },
  },
  {
    sequelize,
    modelName: "UserSetting",
    tableName: "user_settings",
    timestamps: true, // 开启时间戳，方便排查问题
  }
);

// 如果你依然想保留和原 User 表的逻辑关系，可以保留，但请确保 User.userId 也是 STRING 类型
/*
User.hasOne(UserSetting, {
  foreignKey: "userId",
  as: "settings",
});
UserSetting.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});
*/

export default UserSetting;
