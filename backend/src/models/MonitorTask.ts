import { DataTypes, Model } from "sequelize";

import sequelize from "../config/database"; // 确保与 UserSetting.ts 路径一致



class MonitorTask extends Model {

  public id!: number;

  public title!: string;

  public shareCode!: string;

  public receiveCode!: string;

  public folderId!: string;

  public processedFids!: string; // 存储为 JSON 字符串

  public chatId!: number;

  public readonly createdAt!: Date;

  public readonly updatedAt!: Date;

}



MonitorTask.init(

  {

    id: {

      type: DataTypes.INTEGER,

      autoIncrement: true,

      primaryKey: true,

    },

    title: {

      type: DataTypes.STRING,

      allowNull: false,

    },

    shareCode: {

      type: DataTypes.STRING,

      allowNull: false,

      unique: true,

    },

    receiveCode: {

      type: DataTypes.STRING,

      allowNull: false,

    },

    folderId: {

      type: DataTypes.STRING,

      allowNull: false,

    },

    processedFids: {

      type: DataTypes.TEXT,

      allowNull: false,

      defaultValue: "[]",

    },

    chatId: {

      type: DataTypes.BIGINT,

      allowNull: false,

    },

  },

  {

    sequelize,

    modelName: "MonitorTask",

    tableName: "monitor_tasks", // 显式指定表名

    timestamps: true,           // 开启时间戳记录创建和更新时间

  }

);



export default MonitorTask;
