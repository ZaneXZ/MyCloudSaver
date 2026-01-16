import { DataTypes, Model, Optional } from "sequelize";
import sequelize from "../config/database";
import User from "./User";

// 1. 在属性接口中增加 folderId
interface UserSettingAttributes {
  id: number;
  userId: string;
  cloud115UserId?: string;
  cloud115Cookie: string;
  quarkCookie: string;
  folderId?: string; // <-- 新增
}

// 2. 这里的 Optional 会自动包含 folderId，无需改动
interface UserSettingCreationAttributes extends Optional<UserSettingAttributes, "id"> {}

class UserSetting
  extends Model<UserSettingAttributes, UserSettingCreationAttributes>
  implements UserSettingAttributes
{
  public id!: number;
  public userId!: string;
  public cloud115UserId?: string;
  public cloud115Cookie!: string;
  public quarkCookie!: string;
  public folderId?: string; // <-- 3. 在类定义中声明属性
}

UserSetting.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: User,
        key: "userId",
      },
      onDelete: "CASCADE",
    },
    cloud115UserId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cloud115Cookie: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    quarkCookie: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 4. 这里的定义是正确的
    folderId: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "0",
    },
  },
  {
    sequelize,
    modelName: "UserSetting",
    tableName: "user_settings",
  }
);

User.hasOne(UserSetting, {
  foreignKey: "userId",
  as: "settings",
});
UserSetting.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

export default UserSetting;
