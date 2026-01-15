import { Request, Response } from "express";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { SponsorsService } from "../services/SponsorsService";
import { BaseController } from "./BaseController";

@injectable()
export class SponsorsController extends BaseController {
  constructor(@inject(TYPES.SponsorsService) private sponsorsService: SponsorsService) {
    super();
  }

  async get(req: Request, res: Response): Promise<void> {
    await this.handleRequest(req, res, async () => {
      return await this.sponsorsService.getSponsors();
    });
  }
}
