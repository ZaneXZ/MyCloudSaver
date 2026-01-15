import { Request } from "express";
import { ShareInfoResponse, FolderListResponse, SaveFileParams } from "./cloud";

export interface ICloudStorageService {
  setCookie(req: Request): Promise<void>;
  getShareInfo(shareCode: string, receiveCode?: string): Promise<ShareInfoResponse>;
  getFolderList(parentCid?: string): Promise<FolderListResponse>;
  saveSharedFile(params: SaveFileParams): Promise<any>;
}
