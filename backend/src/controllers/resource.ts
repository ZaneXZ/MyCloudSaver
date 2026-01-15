import { Request, Response } from "express";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { Searcher } from "../services/Searcher";
import { BaseController } from "./BaseController";

@injectable()
export class ResourceController extends BaseController {
  constructor(@inject(TYPES.Searcher) private searcher: Searcher) {
    super();
  }

  async search(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      const { keyword, channelId = "", lastMessageId = "" } = req.query;
      return await this.searcher.searchAll(
        keyword as string,
        channelId as string,
        lastMessageId as string
      );
    });
  }
}
