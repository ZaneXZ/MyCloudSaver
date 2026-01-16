import { Model, DataTypes } from 'sequelize';
import { sequelize } from '../core/database'; // 请确保路径指向你的 sequelize 实例

class MonitorTask extends Model {
  public id!: number;
  public title!: string;
  public shareCode!: string;
  public receiveCode!: string;
  public folderId!: string;
  public processedFids!: string; // 数据库存为 JSON 字符串
  public chatId!: number;
}

MonitorTask.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  shareCode: { type: DataTypes.STRING, allowNull: false, unique: true },
  receiveCode: { type: DataTypes.STRING, allowNull: false },
  folderId: { type: DataTypes.STRING, allowNull: false },
  processedFids: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
  chatId: { type: DataTypes.BIGINT, allowNull: false }
}, {
  sequelize,
  modelName: 'MonitorTask',
});

export default MonitorTask;
