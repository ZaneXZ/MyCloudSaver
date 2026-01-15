import { Request, Response } from "express";
import { BaseController } from "./BaseController";
import { ICloudStorageService } from "@/types/services";

export abstract class BaseCloudController extends BaseController {
  constructor(protected cloudService: ICloudStorageService) {
    super();
  }

  async getShareInfo(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      const { shareCode, receiveCode } = req.query;
      // await this.cloudService.setCookie(req);
      return await this.cloudService.getShareInfo(shareCode as string, receiveCode as string);
    });
  }

  async getFolderList(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      const { parentCid } = req.query;
      await this.cloudService.setCookie(req);
      return await this.cloudService.getFolderList(parentCid as string);
    });
  }

  async saveFile(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      await this.cloudService.setCookie(req);
      return await this.cloudService.saveSharedFile(req.body);
    });
  }
}
