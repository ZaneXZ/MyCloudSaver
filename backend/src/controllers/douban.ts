import { Request, Response } from "express";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { DoubanService } from "../services/DoubanService";
import { BaseController } from "./BaseController";

@injectable()
export class DoubanController extends BaseController {
  constructor(@inject(TYPES.DoubanService) private doubanService: DoubanService) {
    super();
  }

  async getDoubanHotList(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      const { type = "movie", tag = "热门", page_limit = "50", page_start = "0" } = req.query;
      const result = await this.doubanService.getHotList({
        type: type as string,
        tag: tag as string,
        page_limit: page_limit as string,
        page_start: page_start as string,
      });
      return result;
    });
  }
}
