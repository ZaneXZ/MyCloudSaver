import { Request, Response } from "express";
import { injectable, inject } from "inversify";
import { TYPES } from "../core/types";
import { QuarkService } from "../services/QuarkService";
import { BaseCloudController } from "./BaseCloudController";

@injectable()
export class QuarkController extends BaseCloudController {
  constructor(@inject(TYPES.QuarkService) quarkService: QuarkService) {
    super(quarkService);
  }
}
