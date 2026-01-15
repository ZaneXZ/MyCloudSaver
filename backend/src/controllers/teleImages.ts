import { Request, Response } from "express";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { ImageService } from "../services/ImageService";
import { BaseController } from "./BaseController";

@injectable()
export class ImageController extends BaseController {
  constructor(@inject(TYPES.ImageService) private imageService: ImageService) {
    super();
  }

  async getImages(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      const url = decodeURIComponent((req.query.url as string) || "");
      const response = await this.imageService.getImages(url);

      // 设置正确的响应头
      res.setHeader("Content-Type", response.headers["content-type"]);
      res.setHeader("Cache-Control", "no-cache");

      // 确保清除任何可能导致304响应的头信息
      res.removeHeader("etag");
      res.removeHeader("last-modified");

      // 直接传输图片数据
      response.data.pipe(res);
    });
  }
}
